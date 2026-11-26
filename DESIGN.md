# Design

*For design tools that read `DESIGN.md` from the repository root (D-529), and for every unit of
the redesign (M64) that builds a screen without asking the maintainer. The direction is
[D-614](./docs/09-decision-log.md) — **the report** — made the language by
[D-615](./docs/09-decision-log.md). The values are not copied here, because a copy drifts (D-437):*

- **The values** — every colour in both themes, the type ramp, spacing, radii, the one shadow,
  durations and easings — are tokens in [`src/ui/theme/tokens.css`](./src/ui/theme/tokens.css),
  each with its reason beside it.
- **The rules** — each with its why and the test that fails when it breaks — are `rule` rows in
  [`docs/memory.emd`](./docs/memory.emd): `format_rows rule match:{scope:ui, state:live}`.
- **Every component and display, in every state, light and dark** is the specimen page,
  `#/specimen` (the dev server and the demo build), drawn from
  [`src/ui/screens/specimens.tsx`](./src/ui/screens/specimens.tsx).
- **What each screen is for, and how dense it may be** is
  [`docs/redesign/screens.md`](./docs/redesign/screens.md) and
  [`docs/redesign/budget.json`](./docs/redesign/budget.json).

**Where this page and a row disagree, the row is right.**

## The direction: a report, not a dashboard

A screen reads like the highlights page of a financial report set on a strict grid. **It answers
first, in words**: the month said as one sentence (`text-lede`), then the one figure that is the
answer, monumental (`text-display`, Plex 300, proportional figures, its symbol and decimals small
and `ink-secondary`). Everything else is columns of exact type below it, every rule one hairline,
hierarchy by size and weight alone. What is waiting sits **below the answer** as one quiet list,
a verb each. Detail opens **beside the page** in a side panel, never on a page of its own, so the
month stays where it was. A change to one value happens in place, a form with several fields
opens in the same panel, a job of several steps (the mapper) takes a page with one way back, a
choice is a popover, and a dialog is only for confirming what cannot be undone (D-617). The rail
is **words**, not icons, in two groups.

The prototype is [`docs/mockups/m64-u3/a/`](./docs/mockups/m64-u3/a/), with
[`b/`](./docs/mockups/m64-u3/b/)'s month strip as the pager and lines that open in place, and
[`c/`](./docs/mockups/m64-u3/c/)'s waiting list and palette. Port from them; diff the words.

## The absolutes

- **Near-monochrome.** `accent` marks what you can act on and never colours a figure; `positive`
  and `negative` are genuine signal only, and never the only carrier. **Figures are ink** — a flow's
  colour is a small mark beside the word that names it, never the figure. **Except a figure that
  sums a period up** ([D-633](./docs/09-decision-log.md)), drawn in `positive` or `negative` by its
  sign (`HeadlineFigure`'s `tone`): Home's left over, and its sentence's two amounts (came in
  `positive`, went out `negative`); the Year's left over; Plan's to split; Wealth's net worth; and a
  statement's gap, `negative` whenever it is not nothing. Every other figure stays ink, and the
  minus sign or the word stays beside the colour.
- **No gradients, no shadows**: elevation is space and hairlines; `--shadow-pop` is for what
  floats (menus, dialogs, a side panel floating over a narrow window).
- **One family**: IBM Plex Sans and Plex Sans Hebrew, self-hosted, 300/400/500/600; 300 only for
  the display figure. Tabular figures in every column and every figure but that one.
- **The ramp, and nothing between its steps**: display 88 · hero 40 · lede 28 · title 24 ·
  secondary-number 20 · heading 16 · body 14 · caption 12 · label 11. A screen spends at most
  seven, and at most one display and one lede.
- **The 8px scale.** Rows are 40px (data), 32px (chrome), 24px (nested).
- **Square** cards and controls. A chip is text with a dot. A data mark's end is rounded 4px
  (`--radius-mark`) and its baseline square.
- **One primary action per screen.** Actions are verbs. An empty state is one sentence and at most
  one text action.
- **Density is budgeted**: `npm run probe:screens -- --document year.emd --budget
  docs/redesign/budget.json --routes …` fails a redesigned route over its limits.
- Motion says what changed — four kinds only, through `src/ui/motion/` — and none of it runs under
  reduced motion.

## The data display kit

`src/ui/charts/` — hand-drawn SVG and HTML, no library (D-608). **Pick by the shape of the data**;
`DISPLAYS` in [`kit.ts`](./src/ui/charts/kit.ts) says when each is right and when it is not.

| Shape of the data | Display |
|---|---|
| a single headline, or a total against its usual | `HeadlineFigure` (display once a screen; tiles in a row), with a `Sparkline` |
| a part of a whole read as a ranked list (where it went) | `RankedBars` |
| a part of a whole (what the saving was made of) | `PartOfWhole` |
| a plan against what happened, a ratio against a limit | `PlanAgainst` |
| a trend over months | `MonthTrend` — 2px lines named at their ends, tooltip and ← → on every month |
| months that are also the way to page them | `MonthStrip` — the open month ink, the rest at 3:1 |
| a flow from one whole to where it went (came in → spent, put aside, left over) | `MonthFlow` |
| a list of rows to act on | a data table: sticky header, hairline rows, numbers right |

Every display keeps its numbers in text beside or under it, takes the caller's empty sentence,
keeps a negative's minus sign and says *over* in words.

## The components to reach for

`SidePanel` (detail beside the page) · `WaitingList` (what is waiting, below the answer) ·
`EmptyState` · `Bidi` (any string from a document) · `ChoiceField` · `IconAction` · `Button`
(one primary) · `Working` (every loading state) · `Flip`, `Reveal`, `useMark` (motion) ·
`CountingAmount` · `ViewTabs` (a section's views — never rows in the rail) · the views under
`src/ui/formats/`.
