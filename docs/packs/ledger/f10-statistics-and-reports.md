---
type: feature
project: Emerald
milestone: M6
status: built — the domain and queries (D-087), the monthly summary (D-088), the yearly overview (D-089), the trends (D-090), the income and fixed-versus-variable sections (D-091), and net worth over time on its own screen (D-107)
---

# F10 — Statistics and Reports

Monthly summaries, category breakdowns, yearly overviews, and trends. All definitions come
from [05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) — this note is about presentation and query design,
not about redefining the math.

## Non-negotiables

- **Every number is drillable.** Tap a total, see the transactions behind it. No aggregate is a
  dead end.
- **Uncategorized is always visible** as its own slice with its own color. Hiding it is how
  these apps quietly lie.
- **Partial months are labeled** and excluded from averages.
- **Aggregation happens in SQL.** With 60k transactions, folding in memory is not an option.
- **One date basis, applied consistently.** Charge date by default; the setting applies
  everywhere at once, and the current basis is shown on the screen.

## Monthly summary

The default view, and now **complete**: built at `#/insights/month` (D-088), with income detail
and the fixed-versus-variable split added by D-091 — the two that needed queries of their own.
**It is Home since D-157**, at `#/`: the dashboard drew the same `monthlyReport` headline above a
link to this screen, so there is one screen and what is left of the dashboard rides on top of it.

For a selected month:

- **Headline row** — Income, Expenses, Balance, and "of which saved". Savings are shown
  separately, never as an expense — and that includes a transaction a format the person declared
  links, which is money moved to something they own whatever its category (D-309), and a
  transaction filed under a category on Categories' Money moved tab (D-316). Home lists what
  makes saved under *Saved* — those rows, the slips' saving lines and the goal deposits (D-361).
- **Comparison chips** — vs last month, vs 3-month average, vs same month last year, each as
  a percentage delta.
- **Category breakdown** — donut plus a ranked list with amount, percentage, transaction count,
  and delta vs the category's 3-month average. Parent rollup by default, expandable to
  subcategories.
- **Cumulative spend curve** — day-of-month cumulative line with the previous month's curve
  ghosted behind it. This is the single most behaviorally useful chart in the app: it answers
  "am I ahead of where I usually am?" at a glance.
- **Largest transactions** — top 10, tappable.
- **Income detail** — paychecks in the period plus non-salary inflows. *Built.* One line per
  payslip and one per **paying merchant**, not per row, so the lines still add to the total in a
  month with two hundred inflows. The two halves are counted from the two places `income` counts
  them — the slips from `paycheck`, the rest from the ledger — because the salary deposit and the
  payslip are the same money and reading one from the other is the substitution D-078 removed. A
  deposit matched to a slip is **not a line and not in the total** (D-317): the slip is the figure and carries the deposit's verdict (agrees, differs by a gap, no deposit, not checked); a deposit filed as salary with no slip is a line that says so.
- **Fixed vs variable** — split of expenses using [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md). *Built.* A split of
  what was **charged**, not of what was declared: one grouping of one scan, with `variable` taken
  by subtraction from the month's own total, so the two sides are the whole of it by construction.
  A `PAYCHECK_DEDUCTION` is on neither side — it never reached the ledger and is already out of
  net — and shows beside the bar with its declared share. The percentage is against this month's
  **income**, the figure printed in the headline above it, rather than against take-home: docs/f09's
  "% of take-home" belongs on the fixed expenses screen, where net is the basis of everything, and a
  ratio here against a denominator this screen does not print is the quiet disagreement one
  `monthlyReport` call exists to stop. A bill that is not due this month says so rather than
  reporting as missing (`isChargeMonth`), and docs/08 B1's second axis is here too: how much of the
  fixed part the user marked cuttable.

Every figure comes from one `monthlyReport` call, so nothing on the screen can disagree with
anything else on it, and **every one of them drills**: tapping a category opens the ledger on that
category in that month. A rolled-up row opens a rolled-up ledger — the parent *and* its children —
which took a widening of the ledger's own filter to make true (D-088).

## Yearly overview

**Built** at `#/year` (D-089; `#/insights/year` until D-157, which dissolved the section it
promoted). A month nobody
imported draws no bars and its table row says so; a month still running is drawn dimmed, counted in
the totals, and left out of the averages and of best-and-worst. The payslip figures are their own
block, because a year with no slips entered still has a spending total and the two absences must not
look alike.

- 12-month grouped bar chart: income, expenses, balance per month.
- Category totals for the year with each category's share and its monthly average.
- Month-over-month table — the spreadsheet view, because sometimes a table beats a chart.
- Annual totals: gross, net, tax paid, total saved, savings rate.
- Best and worst months by balance, with the reason (a large one-off, usually).

## Trends and comparisons

**Built** at `#/trends` (D-090; `#/insights/trends` until D-157), and **part of Home · Year since M28 U5** (D-313): each category's line beside its total, the merchants, the same month a year apart. **Net worth over time is built too, and lives on its own
screen** — `#/wealth/worth` (D-107) — rather than as a row here: every other trend on this screen
reads the ledger and net worth reads none of it, so it belongs beside the savings and debts it is
made of. The window is twelve or twenty-four months and is *filled in*, so a span the document only
partly covers shows its gaps rather than compressing them away.

- **Category over time** — one category's monthly spend for 12–24 months, with a trend line.
- **Merchant leaderboard** — where the money actually goes, by merchant rather than category.
  Often more revealing than the category view. *Built*, grouped on the normalized merchant so
  branches of one shop are one row, carrying **how many months** each appears in — a single flight
  outranks a year of coffee on total alone, and the count is what tells them apart. Its share column
  says it is a share of the merchants listed, not of everything spent.
- **Savings rate over time** — including payroll savings, per [F04 Paycheck Tracking](./f04-paycheck-tracking.md).
- **Net worth over time** — built at `#/wealth/worth` (D-107) and **removed**: the screen went, and
  M36 U07 deleted the unread history. Net worth is one figure today (Wealth's Overview).
- **Year-over-year** — same month across years, and rolling 12-month totals which smooth out
  seasonality far better than calendar years.

## Query design

**Built** (D-087): `statisticsRepository.ts` groups and sums, `domain/statistics.ts` does everything
on top, and neither half can do the other's job. `monthlyReport` and `yearlyReport` are the two
doors — one call each, so a headline, its chips, its breakdown and its curve are views of one read
rather than four that can disagree (D-071's rule).

**No materialized table.** This note says to consider one only if profiling shows the view is too
slow, and to not build it preemptively; nothing has been profiled against 60k rows yet, so nothing
has been built. The date basis is spelled once, as a constant every query in the file interpolates.

Statistics must not scan the ledger repeatedly:

- A **monthly aggregate view** in SQL grouping by (period, category, direction) is the backbone
  of nearly every screen. Charts read from it.
- Consider a materialized `monthly_category_totals` table refreshed on import commit and on any
  transaction edit, if profiling shows the view is too slow. Do not build it preemptively.
- Every query takes the date basis and the exclusion flags as parameters — no query hardcodes
  the definition of "expense".
- Charts receive pre-shaped, pre-limited data. A chart component never queries.

## Chart inventory

| Chart | Used by |
|---|---|
| Donut with legend | Category breakdown — **built** (D-088) |
| Grouped bars | Yearly income/expense/balance — **built** (D-089) |
| Line with comparison series | Cumulative spend — **built** (D-088); trends — built (D-090), never put on a screen, and removed in M45 U2; net worth — **built** (D-107), the first series here that can go below zero |
| Stacked horizontal bar | Split visualization — **built** (D-051); fixed vs variable — **built** (D-091) |
| Progress ring | Savings goals, debt payoff |
| Sparkline | Paycheck list, candidate amount history |

Every chart has an accompanying list or table — for accessibility, and because the exact number
is often what the user wanted anyway.

## Export

- CSV of transactions with resolved category names, respecting current filters. **Built** (D-119),
  on the ledger's own header. **Uncapped** — the screen stops at 500 and the file does not, for
  `summarizeTransactions`' reason: the honest total of a filter is not the total of its first 500
  rows.
- CSV of the monthly summary table. **Built** (D-119), on the insights header, and it exports
  every month the document holds rather than the one on screen — a one-row spreadsheet is a
  figure the screen already shows better.
- Three things carried in those two files that are easy to lose: a **UTF-8 BOM**, without which
  Excel renders every Hebrew merchant as mojibake; **plain decimal amounts** with no symbol and no
  grouping, so the column sums; and an **empty cell for an unknown savings rate**, never a zero,
  because a month with no income has no rate and a spreadsheet would average the zeroes.
- A shareable image of the monthly summary is a nice-to-have, not required.

## Edge cases

| Case | Behavior |
|---|---|
| No data for the selected month | Empty state with a link to import, not a blank chart. |
| Only a partial current month | Labeled "month in progress"; excluded from averages; projections clearly marked as projections. |
| A single transaction dominating a category | Shown; the delta chip explains why the category jumped. |
| Refunds exceeding spend in a category | Negative category total — displayed as negative, never clamped to zero. |
| Category renamed or merged mid-year | Historical figures follow the merge; the yearly table reflects the current taxonomy with a note. |
| Multiple currencies | All reporting in ILS at the charged amount; foreign originals shown only on transaction detail. |
| Missing month in the middle of a year | Gap shown as a gap, not as zero. Zero and unknown are different. |

## Acceptance criteria

The first and third are **met** (D-087), and the first is met structurally: the yearly totals are
computed from the same `MonthSummary[]` the monthly table prints, so there is no second query to
disagree with. The third is tested against the ledger's own summary with a refund and an excluded
settlement present — the two rows that could make a category total and a drill-down differ. The
second and fourth wait on the screens and on a database worth profiling.

- Monthly figures for a year sum exactly to the yearly figures, on any date basis.
- Switching the date basis changes every screen consistently, with no stale caches.
- Category totals equal the sum of the transactions the drill-down shows.
- The monthly summary renders in under 200 ms on a 5-year database.

## Open questions

- ~~Charting library versus hand-rolled~~ — **resolved**. Charts are hand-rolled SVG components,
  scales and paths included ([09 Decision Log](../../09-decision-log.md) D-019). The six types here
  are all simple, and every charting library would fight [11 UI Design Language](../../11-ui-design-language.md) rather than
  serve it — no gridlines, no axis boxes, no markers, 1.5px ink strokes. Hand-rolling is roughly
  a week and the result is exactly the design.
- ~~Should projections ("at this rate you'll spend ₪X by month end") be included?~~ — **settled as
  recommended** (D-087). `CumulativeCurve.projectedTotal` is a neutral figure, on that chart and
  nowhere else, and it is `undefined` on a finished month, where the total is the answer rather
  than a guess. No verdict, no sentence, no colour.
- Budget-versus-actual per category depends on `monthlyTargetAmount` from
  [F02 Category System](./f02-category-system.md) — include once targets are actually being used.

## Related

[05 Domain Rules and Calculations](./05-domain-rules-and-calculations.md) · [06 Navigation and Screens](./06-navigation-and-screens.md) · [F02 Category System](./f02-category-system.md) · [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md)
