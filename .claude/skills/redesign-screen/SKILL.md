---
name: redesign-screen
description: Rebuild one of Emerald's screens in the redesign's direction (M64, D-614 "the report", D-615 the language) — the screen's one question answered first, every block kept, moved one click behind what it explains, or cut, the kit's displays only, the density budget passed, a taste check and its fixes, light, dark and Hebrew. Use in this repository for every M64 unit that redesigns a screen or route ("redesign the Year screen", "rebuild Transactions in the new direction", "M64 U6"), and whenever a route comes off the budget's exempt list. Not for reviewing a screen without rebuilding it (that is design-review), and not for a new screen that has no inventory row yet.
---

# Redesign a screen

How M64 U5 rebuilt Home (D-616), kept to what worked. **The rules are rows, not this file**
(D-437): `format_rows rule match:{scope:ui, state:live} columns:[name, statement] limit:100` on
`docs/memory.emd`, read once, never restated.

## 0. Read, in one turn

- The screen's row in [`docs/redesign/screens.md`](../../../docs/redesign/screens.md): what it
  *asks*, its jobs, its blocks now, the shape of each, what *repeats* another screen and what
  belongs *one click behind*. That row is the plan; do not re-derive it.
- [`DESIGN.md`](../../../DESIGN.md) and the kit's `DISPLAYS` in
  [`src/ui/charts/kit.ts`](../../../src/ui/charts/kit.ts) (which display for which shape).
- The screen's source and its parts, in one shell call that prints every region you need.
- What drives the screen: `grep -n "data-tour\|data-guide"` in its files, and the tours' anchors in
  `fixtures/synthetic/demo/tour_step.format.md`. **An anchor a tour clicks must survive**, on
  whatever now carries its job (Home's `read-files`, `choose-categories`, `went-<category>`).

## 1. Probe before

`MSYS_NO_PATHCONV=1 npm run probe:screens -- --document year.emd --routes '<route>' --themes light,dark --budget docs/redesign/budget.json`
— the numbers you will beat. (Without `MSYS_NO_PATHCONV=1`, Git Bash turns `#/` into a Windows
path and the route's limits are silently not applied.) `year.emd` is the synthetic year (D-608);
**never a working `.emd` of the maintainer's, not even a copy.**

## 2. The question, and the table

The screen's question goes in its title or its first sentence, and the answer comes first, in
words (*The answer comes first, in words*). Then a **keep, move or cut table, one line per block
now, with a reason each**, written into the unit's report:

- **keep** — it answers the question; draw it with the kit display its shape names.
- **move** — it explains something on the screen: put it **one click behind what it explains**,
  in the `SidePanel` (a figure opens its breakdown, a category its rows, a waiting line its
  answers). The panel keeps its kind while the screen pages, so it speaks of what is open.
- **cut** — another screen already shows it (Home's *All months* is Year's *The months*): name
  that screen in the reason.

**Nothing leaves without a place.** Every moved or cut block is reachable in one click from the
screen, and still reachable from a conversation (the plugin's tools — *Anything a person can do on
a screen, a conversation can do too*); say which tool in the table when it is not obvious.

What waits on the person (questions, the guide, a missing file) is **one strip below the answer**,
drawn only when something needs them: the shared `WaitingList`, one sentence and one verb a line.
A verb opens the answers beside the page; it leaves the page only when answering needs a screen of
its own (Home's *Choose categories* goes to By merchant, and a tour walks it).

## 3. Build from the kit

- **The displays from the kit, never a one-off.** A shape the kit lacks gets a display in
  `DISPLAYS` (its `use` and `not`) and a specimen first; a display that needs one more thing (a
  row that opens, a tour anchor) gets it as an optional prop, so the specimen still draws.
- Figures are ink; a flow's colour is a mark beside its word, if at all. Category dots cost a
  colour each against the budget: Home dropped them from Where it went to fit.
- Words are the catalogue's (`src/i18n/en` and `he`), in the same commit, and **the words the
  screen no longer says are deleted from both** — list them with a grep of `'<screen>.…'` keys
  against `src/`, not by memory.
- Files: delete what nothing uses any more (Home's `MonthChart`, `IntakeBand`), and take them off
  the guard lists (`src/i18n/words.test.ts`, `src/ui/formats/surfaceRules.test.ts`); add the new
  files to the same lists.
- **Edits to `.tsx` under `src/` from a script**: some files are CRLF — read with
  `newline=''`, swap `\r\n` for `\n`, edit, swap back. A literal `⁦` typed into a shell
  command arrives as the character itself; build escapes from character codes.

## 4. Probe after, and the budget

Run the same probe with `--shots`. Then **take the route off `exempt` in
`docs/redesign/budget.json` and tighten its limits** to the measured values with a little room
(edit the file as text: a JSON round-trip rewrites `4.0` as `4` across the file), and run it again
with `--budget`: it must exit 0 for the route. `src/ui/budget.test.ts` checks `exempt` only shrinks.
Also run it with `--lang he` (and look at the shot): a Hebrew sentence, a mirrored strip, a sign
that stays before its number.

## 5. The taste check, and its fixes, before landing

One **background** `impeccable:impeccable-finish-reviewer` with a self-contained brief: the
contract (`DESIGN.md`), the comp (`docs/mockups/m64-u3/a/`), the tokens, the kit, the screen's
question, the absolute paths of the light, dark and Hebrew shots (copy them out of
`.probe/shots/` first — the next run overwrites them), the source files, and *read only, edit
nothing, at most ten material fixes*. While it reads, verify the panels in the browser pane
(`preview_start demo-tour`, `app.html?document=year.emd#/<route>`; `read_page` and
`javascript_tool`, a screenshot only for what is visual).

**Make the material fixes that the rows allow; where the comp and a rule row disagree, the row
wins** and the report says so (Home kept its filled Read files: *One primary action per screen*
says filled). A fix it asks for that needs data the domain does not have is a follow-up, named.
Then `design-review`'s hand audit for the rules (its section 1), once.

## 6. Tests, tours, and the report

- The screen's tests **updated on purpose**: a test that pinned a block you cut is rewritten to pin
  the new shape (answer first, what waits below it, detail in the panel), never deleted quietly.
- `npx vitest related <changed files> --run`, `src/privacy.test.ts`, `npm run typecheck`,
  `npm run docs:check`; the full suite once if the screen is broad.
- **`npm run check:tours`** whenever a tour passes through the screen.
- The report lists **what moved where** (the table), the probe before and after, the taste
  check's fixes made and the ones declined with why, and what the maintainer would see that is
  wrong if it were.
