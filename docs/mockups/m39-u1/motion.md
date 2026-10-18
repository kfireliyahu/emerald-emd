# M39 U1 — the four motions, on the real app

> **Not approved.** Built on 2026-10-07 by the run-milestone driver without stopping for the
> author's look (his instruction that day: he tests everything after the run). U2 and U3 port it;
> **nothing here is the rule until it has been reviewed**, and every choice below is open to review.
>
> **U2 ported motions (1) to (3) unapproved** (2026-10-07, D-423): they are on in every build, the
> demo and `check:tours`, with the choices below as they are, and the rules are in
> [docs/11](../../11-ui-design-language.md#the-four-motions-m39-d-421-d-423). **Except choice 8**:
> the author kept D-167 that day, so figures still count and the mockup's snapping was not ported.
>
> **U3 ported motion (4) unapproved** (2026-10-07, D-424), so all four are on everywhere and **the
> switch below is gone** — the pill, the palette entry and the slow-down box with it (the browser's
> own animation tools slow these as well). Choice 4 stands as written — a fade, not a crossfade —
> and `fc-view-enter` itself became it, so the 4 px rise is gone from every screen. Closing reaches
> every dialog, popover, menu, drawer and panel the app has, not only the palette (`closing.ts`).
> *How to see it* below describes the mockup as it was.

## How to see it (the mockup, before U3)

The mockup runs on the **dev server only** — `import.meta.env.DEV` is false in every build, so the
app, the demo and `check:tours` are exactly what they were with the switch off.

1. `npm run dev` (or `npm run dev:desktop` for the shell), open any document with a declared format.
2. Turn it on: the palette (`Ctrl+K`) → **Motion mockup: turn on**, or `?motion=on` before the hash
   (`http://localhost:5173/?motion=on#/formats`). A pill at the bottom left says it is on; it has a
   **4× slower** box for seeing *what* moves (never for judging how it feels) and **Turn off**.
3. On a format's sheet:
   - **(1) rows** — type a row into the foot and leave it, or delete one (the bin at the row's end on hover, then Delete in the panel).
     The new row grows into place and the rows below slide down; a removed one shrinks out of where
     it was and the rows below slide up.
   - **(2) layout** — the `+` after the last column (the panel opens by making room, the sheet gets
     shorter as it does, the columns right of the new one slide over); move a column by its grip or
     with the arrows; Cancel (the panel fades out of its room).
   - **(3) a verdict** — on a format with a claim, open an entry and type a figure that breaks it:
     the chip is marked once. The same on the sheet when a write from a conversation changes a row's
     verdict while you look at it.
   - **(4) navigating and closing** — any route change; the palette closing.

**What would be wrong:** anything that moves when nothing changed; a figure that stops counting (D-167 stands); a mark that
plays twice or loops; anything still moving after a quarter of a second, apart from the mark's fade;
a row or panel you cannot click while something is moving; any motion at all with the OS's
*reduce motion* on.

## The approach U2 and U3 port

**One module, `src/ui/motion/`, not per-screen code.** Four motions over a dozen screens is the case
for one place: a duration, an easing and the reduced-motion rule written once, and a screen that
wants motion wraps its pieces rather than animating them.

| File | What it is |
|---|---|
| `motion.ts` | the switch, `motionOn()` (off under reduced motion, read at the moment a motion starts), the one duration, fade and easing |
| `flip.ts` | the FLIP plan as a pure function — moves, enters, exits, the crowd rule — tested without a DOM |
| `Flip.tsx` | renders one element and FLIPs its keyed pieces when `flipKey` changes; removed pieces leave an inert ghost |
| `Reveal.tsx` | a panel opens by growing its room and closes by fading out of it; a dialog closes with a fade |
| `useMark.ts` | a verdict that changed is marked once, keyed by name through `useChanges` |
| `MotionSwitch.tsx` | the pill; dev only — removed in U3 |
| `closing.ts` | U3: what pops in fades out, one page-wide watcher |

Wired, for the mockup, into the format sheet (`RowSheet.tsx` — rows and columns), the panels under it
(`FormatRows.tsx`), an entry's claims (`EntryView.tsx`), the routed views (`App.tsx`), the palette
(`CommandPalette.tsx`) and `useAnimatedNumber.ts`. U2 takes it to the other lists, panels and drawers.

**FLIP over the Web Animations API, not view transitions** — though Electron 44's Chromium has
same-document view transitions:

- a view transition snapshots the page and, by default, its overlay takes the clicks while it runs;
  FLIP leaves the real elements in place, so nothing is ever blocked, which U3's brief requires;
- a view transition needs every change wrapped in `startViewTransition` + `flushSync` at the moment
  it is made — and the sheet's changes arrive from the foot, a panel, the store and the disk watcher
  (a conversation's write); FLIP measures around React's commit, wherever the change came from;
- a row to be moved must carry a `view-transition-name`, so a five-hundred-row sheet is five hundred
  snapshots; FLIP measures and animates only the rows you can see.

**Keys are names, not ids.** A text document renews a row's id when it changes (D-247), so a row
edited by a conversation would read as one leaving and another arriving; the sheet keys a row by its
name and which of that name it is, as `useChanges` keys a roadmap.

## The choices open to review

1. **Durations** — every move and growth **180 ms** (`--duration-base`); navigating and closing
   **150 ms**; the verdict's mark fades over **900 ms** (the one longer than the brief's range,
   because a tint gone in 180 ms is not seen).
2. **One easing** — `cubic-bezier(0.22, 1, 0.36, 1)`, the app's `--ease-out`, for everything.
   Front-loaded: a piece is nearly there at once and settles. docs/11's ease-in-out for movement
   between two states is not used.
3. **The verdict's mark** — a tint of the verdict's own tone (negative for failed, positive for
   proved, ink for unchecked) behind the word or chip, there at once and faded out, **once**. Not a
   pulse, a shake or an outline; `accent` never (a verdict is found, not acted on, D-125). Every
   change of verdict is marked, not only *to failed* — say if only failures should be.
4. **A route is a fade, not a crossfade** — the new screen fades in over 150 ms, opacity only; the
   old one goes at once. A true crossfade holds a copy of the old screen over the new for 150 ms;
   say if you want it. Today's route fade is 260 ms with a 4 px rise.
5. **Closing a panel fades it out of its room** while the room closes, 150 ms; opening grows it at
   180 ms. Closing is shorter on purpose: nothing is being explained.
6. **A new row grows in** — fades up while a clip opens downwards — rather than sliding in from a
   side or dropping from above.
7. **A crowd snaps.** More than three rows entering or leaving at once (a search, a reload) is a list
   replaced and nothing moves; a **new sort snaps** too, rather than every row gliding to its place.
8. **No figure counts — and that is a change.** *Not ported: the author kept D-167 (2026-10-07), so
   figures count as before.* docs/11 calls *numbers animate when they change*
   the app's signature (D-167); the brief's rule is that nothing animates a number, so with the
   mockup on the splitter's amounts, the fee-impact range and the ledger's filtered total snap. U2
   either retires `useAnimatedNumber` or the author keeps it as the one exception.
9. **Widths do not animate** — a column dragged wider follows the hand already.

## Measured

On the dev server (React's development build), a format of 400 rows, the sheet showing 200:

- **Adding a row**: measuring before React commits **0.8 ms**; measuring after and starting the
  animations **9.4 ms** (most of it the layout the browser does anyway); 27 rows moved and 1 grew —
  the rows in view, not the 200. The commit frame itself is ~130–155 ms **with motion on or off**
  (the dev build re-rendering 200 rows); with motion on it adds one long frame, and every frame
  while the rows move is a normal one.
- **Removing a row**: one ghost, inert and taking no clicks, gone when its 180 ms are; 25 rows slid up.
- **Opening a panel**: its room grows 0 → 577 px in 180 ms and the sheet shrinks with it; closing it,
  the rows under it are clickable at once.
- **Reduced motion** (`matchMedia` answering *reduce*): no animation started, no ghost; CSS
  animations were already collapsed by `tokens.css`.
- **Switch off**: no keys drawn, no animation, the route's class is today's `fc-view-enter`.

## Not done here (U2 took the first two)

- Only the format sheet, its panels, an entry's claims, the routes and the palette move. Boards,
  roadmaps, the ledger's lists and drawers are U2's.
- The tour runner does not yet wait for motion to settle (U2's brief); `check:tours` runs with the
  switch off, so nothing it measures moves.

## F1 — everything that appears, covered or deliberately not (2026-10-07, D-425)

The author, trying U1–U3: many things still popped in, typing re-grew a header, and the tours showed
no motion. **Rule since F1**: what *opens* carries `fc-pop-enter` (a CSS keyframe that plays on mount,
and `closing.ts` fades it out); what *takes another's place* — a flow's step, a view swapped in —
carries `fc-view-enter` (the 150 ms fade) and is **keyed**, because two branches returning the same
element at one place are one element to React and the keyframe never replays. No per-screen timing,
no wrapper component: a class on the element that was already there, or a `div` where there was a
fragment. Audited by sweeping `src/ui` for every conditional element.

**Covered — formats and the engine's screens**: the column card (`ColumnQuestions`) and the computed
column's (`DerivedQuestions`), with the type tiles → details step keyed and faded; the claims card
(`ShapePanel`'s ADDS_UP), the order note, a written-out claim's card, its section, a column's claim
answer; the formula field's names list; the declare flow's steps (naming → columns, keyed), the
doors ↔ list swap, the example and import panels; the connection window, each of its states keyed
(main, delete, apply, refused…), its *match by date* and *adds up* sentences; the connection graph's
bubbles and folded packs; the board's *Not moved* notice; the sheet's refused-write bar; *What looks
wrong* (the band and an entry's); the rollup view; the format delete panel; the intake panel's
*Split by* and fixed values; the units a quantity knows.

**Covered — the shell**: creating or opening a document — the document bar's two states (keyed), each
rail section and each page under one (`fc-row-enter`, so a format just made arrives in the rail like
a row); the drop overlay (fades in and out); every notice; the context menu and its submenu; the
category picker's create step; *+ New…* forms (`SelectOrNew`, the debt one); the guide's dialogs
(its own `fc-guide-in` keyframe deleted for `fc-pop-enter`), its toast (fade: its `translateX`
centring would fight a pop's transform) and the *Getting started* line; the mapper's failure banner,
preview and stage bar; the demo's file chooser (its scrim now says `data-motion-close`, so the dialog
inside fades out with it); a list's detail pane beside the list (it had a close and no entrance).

**Covered — the ledger pack**: every problem banner (Accounts, Categories, Debts, DeductionTypes,
FundDetail, Funds, Goals, Paychecks, Plan, ReadStatements); the delete confirms (Debts, Funds, Goals,
Plan's plan and bucket, *Stop tracking*); Plan's rename form, basis, goal suggestions, record offer and
receipt; the category detail pane; a merchant's charges; Home's *Written* banner; GoalDetail's add form
and the readings form; GoalEditor's *already there*; the where-picker's list; the net-worth row's
inside, its holding and place editors, merge, rename and opening-balance panels; Overview's new
account and place; ReadFiles' reader editor, rename and result; the payment review's prompt; a bill
candidate's editor; the dismissed merchants; *Show the document* beside a slip or a fund report; the
deduction-type add form; the local-model probe results.

**Already covered before F1** (U2/U3): the palette, every `ChoiceField` list, the category, parent,
appearance and points-at pickers, the show-as and pick menus, the merge, move, delete and promotion
panels, the rule editor and re-apply panel, the transactions' bars, learning offer and detail panel,
the settlement and transfer prompts, the overlay drawer, every `Reveal` panel, rows (`Flip`).

**Deliberately not:**
- **An editor in place of the text it edits** — a format's or mapping's rename, an entry's seamless
  fields, a bucket's rename, a sheet header's role — shows the same words where they were; a fade
  would blink them.
- **A single line of text** — an error under a field, *Written 09:41*, a caption, an applied count —
  and a button or control that shows up (Arrange, Fold, a move grip): a line is read, not watched.
- **What follows the pointer** — the drop bar while a column is dragged, a plan bar's drag tip, a
  chart's hover labels, a document line under the cursor: motion would lag the hand.
- **A confirm that is a fragment inside a table cell** (DeductionTypes, Paychecks, net-worth's
  *Really delete*): it replaces two buttons in place, and would need a wrapper to move.
- **Native `<details>` and `window.confirm`**: the browser draws them.
- **The recents under the start screen**: they arrive inside the start screen's own fade.
- **Typing.** A keystroke is none of the four (below).

**Typing moves nothing.** The custom tour's step 2 re-grew the new column's header on every key: the
sheet keyed a column by its *name*, so each letter was a column leaving and another arriving — a new
`flipKey`, a measure of every header and a grow. A column being made now keys by its draft's key
(`RowSheet`'s `columnKeys`, from `NewFormat`), and the *new column* header carries the same key, so
the first letter changes nothing either: measured, `author` typed into a new column starts **0**
animations, where it started one per key. `check:tours` types every field a key at a time and fails a
tour whose keystroke after the first starts any layout motion — reverting the fix fails it at
*Step 7: typing "sh" moved a th (head|c:sh)*.

**Why the tours showed no motion.** The motions did run inside the frame — reduced motion was off
and the demo server (`dev:demo`, up since 11:38, before U1) serves the working tree, so it was not
stale code — but what each scene brings on is exactly what had none: the column card, the claims
card, the type step, the new format in the rail. The one thing that did move moved on every key. On
the host page now, one loop of the custom tour plays the card pops, the step fades, the header's one
grow per column, the claims room opening, the rows sliding as the receipt is written, and the rail's
new page arriving. The tour's settle waits for a card's pop as well (`settle.ts`): it moves its box a
few pixels while it plays.

