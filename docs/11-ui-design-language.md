---
type: spec
project: Emerald
---

# 11 — UI Design Language

**A report, not a dashboard** ([D-614](./09-decision-log.md), made the language by
[D-615](./09-decision-log.md), M64 U4). A screen answers first, in words — one sentence, then the
one figure that is the answer — and everything else is exact type in columns below it, every rule
one hairline. Black on white; one accent, for what you can act on. **The numbers are the
interface**, and since M64 they are also budgeted: how much a screen holds is measured and has a
ceiling.

This note says where things are and why the language is this one. It holds no value and no rule,
because both drift when copied (D-437).

## Where things are

| What | Where |
|---|---|
| Every value: colours in both themes, the type ramp, spacing, radii, the one shadow, motion | [`src/ui/theme/tokens.css`](../src/ui/theme/tokens.css), each with its reason |
| Every rule, with its why, its decisions and the test that fails when it breaks | the `rule` rows with `scope: ui` in [`memory.emd`](./memory.emd) |
| A summary for a design tool, and the kit by shape of data | [`DESIGN.md`](../DESIGN.md) |
| Every component and display in every state, light and dark | `#/specimen`, from [`specimens.tsx`](../src/ui/screens/specimens.tsx) |
| The data display kit, and when each display is right | [`src/ui/charts/kit.ts`](../src/ui/charts/kit.ts) (`DISPLAYS`) |
| What each screen is for, measured | [`redesign/screens.md`](./redesign/screens.md) |
| How dense each screen may be | [`redesign/budget.json`](./redesign/budget.json), checked by `probe:screens --budget` |
| The prototypes the language was picked from | [`mockups/m64-u3/`](./mockups/m64-u3/index.html) |
| The mark | [`src/ui/emerald.svg`](../src/ui/emerald.svg), and [`emerald-basic.svg`](../src/ui/emerald-basic.svg) where facets turn to mush |

```
format_rows rule match:{scope:ui, state:live} columns:[name, statement]
format_rows rule search:"chart"        # or "motion", "accent", "rail", "density"…
```

**A code comment that cites `docs/11` for a rule means these rows** (D-437).

## Why this language

M54 reviewed every screen against the rules and every screen still read as dense: nothing checked
how much a screen held or whether a newcomer could tell what it was for (D-606). Three directions
were built as working screens on a synthetic year (U3, D-608), and **A, the report**, was picked
with two parts of the others (D-614):

- **From A** — the month said in one sentence, left over as one monumental figure, a rail of words
  in two groups, and detail opening in a side panel without leaving the month.
- **From B** — the fourteen-month strip as the way to page months, and lines that open in place
  and stay open as months page.
- **From C** — what is waiting, as one quiet list below the answer; `Ctrl+K` to go to, or ask; a
  figure's affordance visible at rest.

What the three taught, kept as the reasons behind the rows: a statement opened by default buries
the answer; the next step belongs below the answer, not in a pager; icon-only rails fail
recognition; a page per figure loses the month; saved beside left over as a peer confuses.

## What U4 changed, and what it left to the screens

U4 changed what every screen shares: the tokens (A's quieter greys, which lift most of U2's
low-contrast text over AA; the display and lede steps; the light and semibold faces; the kit's
mark colours), the rail (words, two groups, a section's views moved to its tab strip), the tab
strip, the general chart (2px lines, 24px bars, the keyboard), and the kit, the side panel, the
waiting list and the empty state. **It rearranged no screen** (U5 onward does, one at a time, each
taking its route off the budget's `exempt` list as it lands).

Two rules that read as UI are `shell` rows because the shell is where they bite: *A button in a
drag region* and *Accelerators are shown, not registered*.

## Related

[06 Navigation and Screens](./packs/ledger/06-navigation-and-screens.md) · [F10 Statistics and Reports](./packs/ledger/f10-statistics-and-reports.md) · [09 Decision Log](./09-decision-log.md)
