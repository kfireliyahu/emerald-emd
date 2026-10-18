# The development tour: storyboard

> **Superseded (2026-10-07):** the author found this tour too complicated; it was replaced by the
> conversation tour, [`tour-development-chat.md`](./tour-development-chat.md) (M33 F5). Kept as the record of U6.

**M33 U6, ported without approval (author, 2026-10-07: run on, he tests after); it awaits review.** The tour for the developer crowd,
true rather than staged: a made-up project kept in the development pack's own formats, walked on the
real app. The brief's five beats are all here, in its order — the board, a unit taken, a state the
list refuses, the roadmap, and a decision linked from a unit — and the sentence to land is the last
caption: the same checks that keep a budget honest keep the sessions honest.

**To watch it:** start `demo-tour` (`npm run dev:demo`, port 4181), then open
`http://localhost:4181/docs/mockups/m33-u2/host.html?tour=development` — the host page, with both
frames playing this tour. Full screen: `http://localhost:4181/?tour=development&autoplay=1`.

## The question

The title is the question a developer has; the line under it says why; the last caption answers it.

| | Title | Line under it | Last caption answers |
| --- | --- | --- | --- |
| **Draft** | *Where did the last session leave off?* | *You build with a model one session at a time, and each new session has to be told what is done, what is next and why.* | from the rows: what is built, who has the next unit, and why each thing is the way it is |
| Alt 1 | *What is this project's next step?* | *A model can build the next unit, if something can tell it which one that is.* | the next unit, taken, with the one it waits on built |
| Alt 2 | *Why is the code the way it is?* | *Six weeks in, nobody remembers why an edit sends only the change.* | the decision, named by the unit that built it (scene 5 alone, the rest as the way there) |

## The scenes, as they play

About 40 s at 1x, then the last caption is held and it loops. Six captions.

| # | Caption | What happens on the real app |
| --- | --- | --- |
| 1 | *Every unit of the project, in the lane for its state: four built, three planned, none in progress.* | The rail's *Development* section opens (on its roadmap, for a moment), then *Unit board*: lanes Planned 3, In progress 0, Built 4, Dropped 0. |
| 2 | *A session takes the next one. It is in progress now, and it says who has it.* | The ring opens the card *M2 U3* (two edits to one item at once); on its page it sets **state** to `in_progress` from the menu and types *session 7* into **taken_by**, Enter; back on the board, M2 U3 is outlined in In progress. |
| 3 | *A state nobody declared is refused, not stored: a milestone is planned, open or closed, and never “done”.* | The *Milestone* sheet. On its empty row the ring types *M4*, *Household*, *Everyone at home on one list.*, **done**, *4*, Enter. Outlined: *Nothing was written. Row 4, state: state must be one of planned, open, closed; got "done".* |
| 4 | *The roadmap: what each milestone is for, what is built, and who has the unit in progress.* | *Roadmap*: M1 closed, M2 open, M3 planned, each goal under its title, units folded under; the line *M2 U3 … taken by session 7 · In progress* outlined. |
| 5 | *Why does an edit send only the change? The unit that built it names its decision.* | The ring opens *M2 U2* (an edit reaches the other phone within a second) from the roadmap, then its **decision**, *D-4*. |
| 6 | *So the next session starts from rows, not from memory, checked the way a budget is.* | D-4's page: *An edit is sent as the one change, never as the whole list*, its question and answer, and *Unit · decision: M2 U2, built* under it. Its title outlined; held. |

## The document it opens

`project.emd`, built by `scripts/make-demo-document.mjs` as a **text document, the file
`docs/memory.emd` is**: the development pack's own declarations and views
(`src/data/packs/development/`), each format under its rows from
`fixtures/synthetic/demo/project.md`, so the rail shows the pack because the document declares its
formats, exactly as it does for the real one. The project is made up: **a shopping list two people
share**. Three milestones (M1 *One list* closed, M2 *Shared* open, M3 *Offline* planned), seven units
(four built, each with a decision and who took it; three planned, with what they wait on), four
decisions and one open question. Nothing of the real `docs/memory.emd` is shown.

The milestone sheet's column widths are kept in the document (`## views` in `project.md`), so its
five columns fit the width the tour lays the app out at.

## What changed in the app for it

- **The pack's `claimed_by` is `taken_by`** (D-420, its own commit): the unit sheet's band says
  *Claims*, and scene 2 is a unit *taken*.
- **A board's lane is at least 200 px wide, not 256**, so the pack's four lanes fit beside the rail
  at 1120 px without the board scrolling sideways. Every board in the app shows it.
- **Enter in a field of an entry page writes it** without waiting for the blur, which a page without
  focus — the demo's frame — never gets. It was the hint's promise already.
- Anchors for the tour: `card-<name>` on a board card, `line-<name>` and `name-<name>` on a roadmap
  line, `field-<column>` on an entry page's text and state fields, and `choice:` also picks a menu's
  item.

## For review

1. **The question**: the draft's title, line and six captions, or one of the alternatives.
2. **The refused state is a milestone's “done”, not a unit's “doing”.** The unit sheet is thirteen
   columns and scrolls sideways at the tour's width; the milestone sheet is five. Keep, or ask for
   the unit (it would need that sheet's widths kept too, and more typing).
3. **The last caption** carries the brief's sentence as *checked the way a budget is*. Alternative:
   *The same checks that keep a budget honest keep the sessions honest.* — closer to the brief, but it
   says what the app is rather than what is happening.
4. **`started` is not typed** in scene 2: a date typed a character at a time reads badly. The
   roadmap shows *taken by session 7* without *since*. Keep, or type it.
5. **Its own document**, `project.emd`, rather than the project added to `demo.emd` as the brief
   said: each tour opens its own document since U3, and the ledger tour's rail stays the ledger's.
6. **The project**: a shared shopping list, or another made-up project.
