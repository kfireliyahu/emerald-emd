# The custom-format tour: the frame and its storyboard

**Kept current by M33 U3 and F1**, which built what the author approved here at ac8c8eb: the tour is
rows now, it opens on the question a visitor has, it starts moving at once, and the frame lays out at
any width. *What U3 changed* and *What F1 changed* at the foot say what is different from the pass he
approved; the rest is the storyboard as it plays today.

M33 U2, the fourth pass, for review. The first (bc37f31) drew the app instead of
running it. The second (a36eb13) ran the real app and had no point a visitor could name. The third
(14115ab) told the grocery receipt with its lines, the ledger and two checks, in 17 captions and about
two and a half minutes. **This pass is the author's ruling on the third**: no ledger, no receipt
lines, one check, six captions (five since F1), under a minute, and a ring that is slower and sits still through a
click. **Seven more asks of his came in during the pass and are in it**: a speed control, an outline
that draws itself around the box the eye should be on, the strip moved above the app, a title and a
line for each tour; then a slower 1x (what was 0.75x), a strip that animates as the tour advances,
and a host page to judge the frame embedded rather than full screen.

**What a visitor should leave with:** describe something you keep, and it becomes a table that won't
let you be wrong quietly, even when the mistake is somebody else's. No caption says that sentence.
The tour shows it happening.

**To open it:** start `demo-tour` from `.claude/launch.json` (it runs `npm run dev:demo` on port 4181),
which opens the frame at `http://localhost:4181/`. After `npm run build:demo`, `demo-static` serves the
same frame from `dist-demo/` at `http://127.0.0.1:4180/`. Narrow the window below 690 to see the movie.
**To judge it embedded**, as visitors will meet it: `http://localhost:4181/docs/mockups/m33-u2/host.html`
on the same server — `host.html` beside this file, a plain stand-in for the site with the frame in
the chapter's wide figure (16:10, the poster's ratio from the site's brief, up to 1040 px) and again
in a 375-wide phone column, 440 px tall, where it plays as a movie.

**Where it lives.** `demo-frame.html` and `src/demo/tour/` are the frame. **The tour is rows** of two
declared formats, `fixtures/synthetic/demo/tour.format.md` (its name, title, line and document) and
`tour_step.format.md` (its 32 steps), which the build puts beside the app page as `tours.emd` and the
frame reads through the engine. **Each tour opens its own document.** `scripts/make-demo-document.mjs`
writes two beside the app page: `custom.emd`, this tour's, which keeps **no pack** and declares one
format, `card_charge` (date, merchant, amount stored positive), with five synthetic rows from
`fixtures/synthetic/demo/card-charges.json`; and `demo.emd`, U1's ledger document, lived in a little since
U5, for the ledger tour (`docs/mockups/m33-u5/tour-ledger.md`). The frame names its document to the app page as `app.html?document=custom.emd`;
with no name the page opens `demo.emd`. `receipt.png` is drawn from `receipt.json` by
`npm run demo:receipt`. Its figures did not change, so it was not redrawn: it still prints the four
items over the 84.00 total, which the tour does not type.

**What a visitor sees first** is the app's own landing for a document without a ledger: *Formats*,
one format, *Card charge — 3 columns, 5 rows, no claims*. The rail has Formats (Card
charge under it), Connections, MCP and Settings, and nothing of the ledger. The first caption opens
the charges.

**The strip, top to bottom**: the tour's title, large, and its line under it; the dots; then one row —
Watch / Try it, the caption, Reset, and the speed. On a phone the caption takes the strip's width and
the dots share a row with Reset and the speed. **The title is the question a visitor has, and the
line says why** (the author, 2026-10-07), a row of `tour`: *Did the card charge what the receipt
says?* — *You kept the receipt from the grocery store. The card statement came in. Do they agree?*
The failure caption answers it, and the captions between are moves toward the answer.

**Every caption is a draft, to be rewritten in review.** A caption says what is
happening, never what the engine is. A row with no caption keeps the one above it. There is one dot
per caption (5), not one per row (32).

## The story

1. **Here is the card statement.** The ring opens the card charges at once: five rows, and **the
   `CORNER MARKET` row, ₪96.00, is outlined**: one of these is the grocery store.
2. **To find out, a receipt is described by hand**: `shop` (text), `date`, `total` (money) and `paid_with`, a link
   to `card_charge`.
3. **The claim**: one, written out, `total = paid_with.amount`. It keeps the name the
   app gives a claim nobody named, `total_adds_up`. There is no minus and no caption about one: the
   charge is stored as what the card was charged.
4. **The receipt is typed in with the paper beside the app**: Corner Market, 2026-07-29, 84.00, and
   its charge picked in the same row (`CORNER` → *CORNER MARKET*). Then it is opened.
5. **The claim fails**: *total_adds_up: failed — ₪84.00 against ₪96.00, off by ₪12.00*, and **the
   verdict is outlined**. The caption answers the title: *They don't: the card was charged 12.00 more
   than the receipt says.* It is held, and the tour loops.

## Pacing

**1x is the author's slower one**: what was 0.75x. **A caption moves at once and is read while it
does** (F1): the ring sets off for its first anchor 0.4 s after the caption comes up, and the
caption's reading time — 1.33 s plus 64 ms a character, **counted from when it came up** (U3), and
**capped at 3.5 s** — is held before the scene's first click or keystroke, not before any motion. The
caption stays up for the rest of its scene. **Then every action runs at one tempo**: the ring
travels in 933 ms, types at 87 ms a character, and takes a 333 ms beat after each action; the last
caption is held 8 s before the loop. **A row that outlines something reads after its outline
instead**: the action brings the box on, the outline draws, and the caption is held with it in view
— the first scene's caption is about the charges, which are not on screen until its click.

Measured in the pane at 1x (F1): **the last caption arrives at 60 s** (U3: about 80 s, its readings
held whole). Scene 2, the declaration, is 30 s of it: twenty rows of form.

Measured in the pane at 1x (F1), at the host page's 800-wide figure, from a caption coming up to the
ring setting off: **scene 1, 0.7 s** (the app is still opening its document); **scenes 2, 3 and 4,
0.4 s**; scene 5 at once. U3 had 5.7, 5.4 and 5.6 s for scenes 2 to 4. The loop is 69 s, its last
9 s the answer held.

**The speed control** scales all of it: a slider in the strip from 0.5x to 2x in quarters, 1x by
default and **0.75x in a phone's crop** (M33 F2, D-416). Every hold — reading, travel, typing, beat,
the loop — is divided by it, and the ring's travel and the crop's pan follow. The speed is remembered
in this browser only (`localStorage`, every read and write in `try`), and an embed with no storage
plays at its default.

**The strip animates as the tour advances**: the progress line fills to the next dot over 260 ms
(`--duration-enter`), the dot reached grows and takes the accent over 180 ms (`--duration-base`),
and the caption — and the title and its line, when they change — crossfade over 260 ms, the old line
fading out over the new one in the same place. Under `prefers-reduced-motion` none of it moves.

## The ring sits still through a click

**The cause, measured:** the ring was placed with `transform: translate(x, y)` and pressed with the
`scale` property. CSS applies `translate`, then `scale`, then `transform`, so the press scaled the
whole `transform` — the position too — about the viewport's corner. At the press's peak a ring at
(500, 300) was drawn at (410, 246): toward the top-left by a fifth of its distance from the corner,
and back, on every click. It was neither the ring following the clicked element nor the half-width
offset.

**The fix:** the ring is placed by the `translate` property and travels by a `translate` transition,
and the press stays a `scale`, which now shrinks it about its own centre. The same measurement after
the fix: (500, 300) at the peak. `src/demo/tour/place.ts` holds the placement arithmetic, tested in
`place.test.ts` with the rule that keeps the two properties apart. The driver's hold when an anchor
measures 0 by 0 or is gone is kept, and the ring is not re-placed for a move under half a pixel.

## The outline

**A row may carry `highlight` (U2 called it `look`): an anchor to outline**, apart from `anchor`, which is where the ring
points. Once the row's action is done the frame draws an accent line once around that box — an SVG
`rect` whose `pathLength` is 100, its one dash drawn from an offset of 100 to 0 in 1.4 travels — and
holds it for the rest of the scene, or until a later row outlines another. It follows its box every
frame, as the ring does, and scales with the movie. Under `prefers-reduced-motion` it appears whole.
It is used twice, where the story needs the eye: the `CORNER MARKET` row (anchor `row:CORNER MARKET`,
the sheet row holding that text, which needs no attribute) and the failed verdict.

## The picks

P1–P16 are the earlier passes', judged again for this story.

| | Pick | Now |
|---|---|---|
| P1 | The ring is the accent | Kept. |
| P2 | A **dot per caption** (5), not one per row (32) | Kept. A jump lands at the start of a caption. |
| P3 | The strip sits under the app | **Reversed by the author: above it.** |
| P4 | **Clicking the app takes over**, the same as Try it | Kept. |
| P5 | The tour **loops** after its last caption, held 6 s or its reading time | Kept. |
| P6 | A movie **below 690** (U3; was 720) | So a 768-wide tablet, a 719 frame on the host page, can take it over. |
| P7 | Rows are typed into the **sheet's empty foot row**, in the document's currency | Kept. The link is picked in the same row now, not on the entry page. |
| P8 | The link column is **declared with the format** (`paid_with` → `card_charge`) | Kept. |
| P9 | The purchase | Corner Market, 84.00; the charge `CORNER MARKET`, 96.00, stored positive. |
| P10 | The rating | Gone since the third pass. |
| P11 | **"From an example" is shown and avoided** | Kept: Start empty. |
| P12 | The labels **Watch / Try it / Reset** | Kept. |
| P13 | The picture sits **beside the app** (260 px), only while it is typed in | Kept, one scene now. |
| P14 | Lines as their own format, joined on Connections | **Dropped** with the lines. |
| P15 | The claim **written out** | Kept, with no minus: `total = paid_with.amount`. |
| P16 | The date is typed **2026-07-29** while the paper prints 29/07/2026 | Still open: tell me if it should be typed as printed. |
| P17 | The claim keeps the **name the app gives it**, `total_adds_up` | Saves a row and two seconds. The other way is to name it `charged`, which reads better on the entry page. |
| P18 | The **speed** is a slider, 0.5x to 2x in quarters, its value shown beside it (*1x*) | The other way is three buttons (slow, normal, fast), which say less and take more room. In a movie the word *Speed* goes and the slider stays. |
| P19 | The **outline** draws in 1.4 travels (1.3 s at 1x), 2 px of accent with 6 px corners, 4 px off the box | Tell me if it should be the ring's fill as well, or thicker. |
| P20 | The **title** is 20 px semibold, the line 13 px secondary, both above the dots | In a movie, 17 and 12. The caption there takes up to three lines. |
| P21 | The **host page** places the frame in a figure wider than the text, 16:10, and at phone width full-bleed, 440 px tall | From the site's brief (the poster's 1600 x 1000). The site's real column is still to confirm. |

## Fixed along the way

- **A blank root after a reopen** (found here). The demo's reopen went Home by writing the hash, and a
  hash written by hand comes back as a location with the router's `default` key, the one it started
  on. When the redirect from the root to *Formats* (a document with no ledger) was still loading, the
  way back looked already done, and the app sat on an empty root: the tour's first anchor never came.
  The reopen goes Home through the router now (`src/demo/main.tsx`), and the root's redirect is keyed
  by its location (`src/App.tsx`), so a way back to `/` decides again.
- **The demo documents stop on a prose refusal.** A declaration the plugin cannot accept answers in
  prose that nothing was written, without an error flag; `make-demo-document.mjs` now fails the build
  on it rather than shipping a document with no formats.

## Anchors

Each anchor is a `data-tour` attribute on the element named. `choice:<text>` is the option with that
text in an open list, matched on its whole text or its first line.

| Anchor | The element | Source |
|---|---|---|
| `nav-<path>` | a rail item, `nav-formats`; a page under one, `nav-formats-card_charge` | `src/ui/Sidebar.tsx` |
| `new-format`, `door-empty`, `format-title`, `add-columns` | **New format**, **Start empty**, the format's name, and on to its columns | `DeclaredFormats.tsx`, `FormatDoors.tsx`, `NewFormat.tsx` |
| `column-name`, `type-<type>`, `points-at`, `add-column` | a column's name, its type tile, what a link points at, and **Add a column** | `ColumnQuestions.tsx`, `RowSheet.tsx` |
| `create-format`, `save-shape` | the shape panel's **Create the format**, or its **Save** | `ShapePanel.tsx` |
| `claims` | **Add a claim**, on the *Claims* band (M33 U3a) | `AddsUpPlace.tsx` |
| `add-claim`, `claim-holds` | **+ A claim**, and a written-out claim's *Holds* | `WorkedOut.tsx` |
| `foot-<column>` | the first foot row's cell | `RowSheet.tsx`, `TypedField.tsx` |
| `row-open` | a stored row's **Open** icon | `RowSheet.tsx` |
| `verdict-<claim>` | one claim's verdict on an entry page | `EntryView.tsx` |
| `row:<text>` | the sheet's body row with a cell holding exactly that text, found by the runner | `runner.ts` |

The others the app carries (`has-many-…`, `total-kind`, `claim-name`, `add-computed`, `field-…`, `link-…`,
`refusal`, …) are not used by this tour.

## The steps

The action is one of `click`, `type`, `press`, `wait` and `say` (D-413). *(receipt beside)* marks
the scene that shows the picture.

*Outlines* is a row's `highlight`.

| Step | Anchor | Action | Value | Caption (draft) |
|---|---|---|---|---|
| 1 | `nav-formats-card_charge` | click |  | Here is the card statement. One of these is the grocery store. *Outlines* `row:CORNER MARKET`. |
| 2 | `nav-formats` | click |  | To find out, describe the receipt: shop, day, total, and its charge. |
| 3 | `new-format` | click |  |  |
| 4 | `door-empty` | click |  |  |
| 5 | `format-title` | type | `Receipt` |  |
| 6 | `add-columns` | click |  |  |
| 7 | `column-name` | type | `shop` |  |
| 8 | `type-text` | click |  |  |
| 9 | `add-column` | click |  |  |
| 10 | `column-name` | type | `date` |  |
| 11 | `type-date` | click |  |  |
| 12 | `add-column` | click |  |  |
| 13 | `column-name` | type | `total` |  |
| 14 | `type-money` | click |  |  |
| 15 | `add-column` | click |  |  |
| 16 | `column-name` | type | `paid_with` |  |
| 17 | `type-link` | click |  |  |
| 18 | `points-at` | click |  |  |
| 19 | `choice:card_charge` | click |  |  |
| 20 | `create-format` | click |  |  |
| 21 | `claims` | click |  | Then make a claim: the receipt's total is what the card charged. |
| 22 | `add-claim` | click |  |  |
| 23 | `claim-holds` | type | `total = paid_with.amount` |  |
| 24 | `save-shape` | click |  |  |
| 25 | `foot-shop` | type | `Corner Market` | Now type the receipt in from the paper, and point it at its charge. *(receipt beside)* |
| 26 | `foot-date` | type | `2026-07-29` |  |
| 27 | `foot-total` | type | `84.00` |  |
| 28 | `foot-paid_with` | type | `CORNER` |  |
| 29 | `choice:CORNER MARKET` | click |  |  |
| 30 | `foot-paid_with` | press | `Enter` |  |
| 31 | `row-open` | click |  |  |
| 32 | `verdict-total_adds_up` | say |  | They don't: the card was charged 12.00 more than the receipt says. *Outlines* `verdict-total_adds_up`. |

After step 32 the tour holds the answer, then loops by reopening the bytes (P5). Step 33, *Your turn.
Describe something you keep, and type in what it says.*, went in F1: it had no point (the author).

## What U3 changed

- **The steps are rows** (D-414): `tour` and `tour_step`, declared in `fixtures/synthetic/demo/`, put
  into `tours.emd` beside the app page by `scripts/make-demo-document.mjs` and read back through the
  plugin before the build goes on. **Not in the document the tour plays**: a visitor's first screen
  there would have had *Tour step* in its rail. The frame reads them itself through the engine, so
  the title and the first caption are up while the app page is still opening. `look` is `highlight`.
- **The first step moves at once.** Measured at 1x before: *Putting the document back…* for 0.9 s
  (the document opened twice, once by the page and again by the tour), then a click, then 4.9 s of
  nothing while the first caption was read. Now the first caption is up at 0.3 s, the first play does
  not open the document a second time, the ring is on its first anchor by 1 s and clicks at 1.9 s,
  and the caption's reading counts from when it came up, so the stillness after the outline is 3.7 s.
  Scene 2's caption is shorter. **Still there**: each later scene holds its caption for its reading
  time before the ring moves, by the author's own rule: about 5.7 s at scene 2.
- **Every width.** The app was laid out no narrower than 960 — 1120 since F1 — (the receipt's sheet is 904 px of fixed
  columns beside the 56 px rail) and drawn scaled below that, filling whatever height the strip
  leaves; beside the paper it is still laid out at 960 and both are drawn smaller. The caption wraps
  rather than being cut, and its cell reserves the tallest of the tour's captions so the app never
  jumps between scenes. A movie below 690. The host page's wide figure is never shorter than 440:
  at 341 wide a 16:10 figure left the app 19 px.
- **The check**: `npm run check:tours` builds the demo and plays every tour once at fast-forward in a
  hidden Electron window, at 1280x800 and 375x440, failing on the first step whose anchor or
  highlight never comes. It found one at phone size: a scroll's event arrives a frame late and closed
  the list the next step opened; the runner now lets that frame pass.
- **`?tour=` names a tour** (the first otherwise); `?autoplay=1` plays it at once, and without it the frame holds the first frame (U4, D-418).

## What F1 changed

The author's look at U3 on the host page, with the browser pane visible (2026-10-07), and D-415.

- **Nothing overlaps or scrolls sideways.** U3 laid the app out at 960 from a 56 px rail the demo
  never shows: its sidebar is 200 px, expanded because the tour clicks a format under *Formats*. The
  receipt's 904 px sheet sat in a 760 px screen and scrolled sideways: the row icons and the `+` were
  off its edge, opening the row scrolled the shop away, and the band over the sheet wrapped *Say what
  adds up* onto a second line at its top-right corner. **The app is laid out at 1120 now** (200 + 904
  + the screen's 10 px scrollbar) and drawn scaled below that, as before. `check:tours` fails any
  row at which a box of the app scrolls sideways, and failed at step 15 with 960.
- **Motion within half a second of every caption** (*Pacing*): the reading is held before the first
  click or keystroke, capped at 3.5 s, and the ring's travel is part of it.
- **Five captions**: the tour ends on the answer, held, then loops. Try it stays in the strip.
- **A phone gets a crop**, not the whole app shrunk to a third. Below 690 the app is still laid out
  at 1120 by 720, and the frame shows a window of it at 0.75 — its 13 px text at 9.75 px —
  kept on the outlined box, else the ring's anchor, and panning at the ring's pace between steps;
  under reduced motion it jumps. A sheet row is kept by what it holds, so the outlined charge shows
  its date, merchant and amount together. The paper is a small card in the window's corner, and the
  window keeps the box it is on clear of it. The strip above is unchanged.
