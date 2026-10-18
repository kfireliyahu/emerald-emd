# The development tour, as a conversation: storyboard

**M33 F5. Approved by the author on 2026-10-07 (bb3ebbe) with the driver's five picks, and ported:**
it replaced U6's tour ([`tour-development.md`](./tour-development.md), superseded). **M33 F6 retired the
shopping list for a generic project and changed the lines below: the new ones are under
[*Changed in F6*](#changed-in-f6-not-yet-approved), and the sections before it are the approved
originals, kept as the record.** The rows are in
`fixtures/synthetic/demo/tour_step.format.md`; to watch it, start `demo-tour` (`npm run dev:demo`, port
4181) and open `http://localhost:4181/?tour=development&autoplay=1`, or the host page at
`/docs/mockups/m33-u2/host.html?tour=development`.

## Title and line

- **Title:** *Ask for a feature. The project answers first.*
- **Line under it:** *The model building your app reads what the project already decided, and writes down what you decide next.*

## The story

The person asks for **undo that puts the whole list back the way it was a minute ago**. The model
answers that this contradicts **D-4, *An edit is sent as the one change, never as the whole list***:
putting the whole list back would also erase whatever the other phone changed in that minute. They
settle on **the undo D-4 allows — taking back your own last change, sent as one change** — and the
model writes it down: decision D-5, milestone M4 *Undo*, and its two units.

## The beats

At most one caption and one chat line are new at a time. Four captions, six chat lines, about 35 s.

| # | Chat line (new) | Caption (new) | On the real app |
|---|---|---|---|
| 1 | **Person:** *Can we add undo? Put the list back how it was a minute ago.* | *A shopping list two people share, built with a model one session at a time.* | Opens on the **Roadmap**: M1 closed, M2 open, M3 planned, units under each. |
| 2 | **Model:** *D-4 says an edit is sent as one change. Putting the whole list back would erase the other phone's edits.* | *The model answers from what the project already decided.* | The ring opens the **Decision** sheet; row **D-4** outlined. |
| 3 | **Person:** *Fair. What undo does D-4 allow?* | — | Unchanged. |
| 4 | **Model:** *Taking back your own last change, sent as one change. Writing it down as D-5.* | *The conclusion is written down, beside the decision it kept.* | **Write 1:** row **D-5** appears under D-4, outlined. |
| 5 | **Model:** *And the work: milestone M4, Undo, in two units.* | — | The ring opens the **Roadmap**. **Write 2 and 3:** *M4 Undo · planned* appears under M3 with its goal, its two units under it; M4 outlined. |
| 6 | **Model:** *M4 U1 can start now: what it waits on is built.* | *The next session starts from these rows: what to build, and why this undo and not the other.* | The line *M4 U1 … D-5* outlined. Held 8 s, then it loops. |

## The rows it writes

- **decision D-5** · M4 · app · *Undo takes back your own last change, sent as one change* · question
  *What does undo do on a shared list?* · answer *It sends the reverse of your own last change, as one
  change. It never puts back an earlier copy of the list, which would also undo the other phone's
  edits (D-4).* · live
- **milestone M4** · *Undo* · goal *A slip of the finger is taken back without touching the other
  person's edits.* · planned · position 4
- **unit M4 U1** · *undo takes back your own last change* · decision D-5 · planned · blocks M2 U2 (built)
- **unit M4 U2** · *an undo of an item the other phone has changed since is refused, and says why* ·
  planned · blocks M4 U1

## How the rows land, honestly

**No model runs in the tour, and the panel says so.** The model's words are written for the tour, as
the receipt was drawn for the custom one. The brief's *as the MCP server's write would* cannot hold
literally: the demo is a static page with no server and no file on disk for the shell's watcher to
see. **The honest version:** a sixth step action, `write`, whose value is exactly what
`record_format_rows` is handed (`format`, `rows`). The frame passes it to a new `DemoHandle.record`,
which runs the same pair the tool runs — `stageRows`, then `insertRows` — inside the document store's
`mutate`, so the open screen redraws as after any write. A batch the engine refuses fails the step,
and `check:tours` with it; nothing is painted into the page. `tour_step` gains `chat` (the line) and
`from` (`person` or `model`).

## The panel beside the app

- **Desktop:** the receipt's place — a column right of the app (the receipt's 260 px), the app scaled
  to fit beside it, for the whole tour. It is the frame's own, outside the app's iframe, in the
  frame's style, not the app's chrome. A header: *A conversation, written for this tour.* Person's
  lines right, model's left; a new line fades in over 260 ms and is held for its reading time, by
  the captions' rule. Earlier lines stay above it, dimmed.
- **375:** the F1 crop (the app at 1120, shown at 0.75), the caption in the strip above as now. The
  chat is **only the newest line**, a card along the bottom of the crop, the way the receipt is a
  card in its corner; the crop keeps the outlined row clear of it, so D-5 and M4 are followed as
  they appear.

## What the author chose (2026-10-07)

1. **The feature and the decision:** undo against D-4.
2. **The title:** *Ask for a feature. The project answers first.* — a statement, since this pack has
   an answer rather than a question.
3. **The panel's header** as written, and **no result line** under a line that writes.
4. **No refusal beat.**
5. **The ending** on the roadmap, with M4 and its units.

The `write` step action through `DemoHandle.record` (the same `stageRows` and `insertRows` the tool
runs) is accepted.

## As ported

- **Eight rows.** The model's writes are three `write` rows at no anchor — the ring is a person's hand,
  and is off while the model writes — the milestone and its units outlined as one box
  (`roadmap-M4`, the roadmap row and what is folded under it), scrolled into view as an anchor is.
- **The panel** is the paper's column at desktop (`Frame.tsx`, `Chat`), and at 375 the newest line as
  a card along the crop's bottom (`ChatCard`), labelled *written for this tour*; the crop's window is
  what is above the card, so the outline and the ring are kept clear of it (`windowOf`).
- **The decision sheet** carries widths in `project.md`'s views, so it fits the 1120 px app without
  scrolling sideways.

## Changed in F6 (not yet approved)

**The author, 2026-10-07:** a specific fake project confuses a visitor; the project is generic, so the
visitor follows decisions, milestones and units rather than a product. The shape is the approved one —
a feature asked for, the model shows it goes against a decision already taken, they settle on what the
decision allows, the model writes a decision, a milestone and its units — and only the words changed.
Drafted by the session; **for review**.

**The project** (`fixtures/synthetic/demo/project.md`): a service with a versioned API. M1 *First
release* closed, M2 *Public API* open, M3 *Monitoring* planned; D-1 settings from the environment,
D-2 every response JSON, D-3 the version in the path, **D-4 *A published version never changes: fields
are added, never renamed or removed***. M2 U2, built, is the test that fails when a /v1 response loses
or renames a field — what M4 U1 waits on.

**The story:** the person asks to rename the API's `created` field to `created_at`; the model answers
that D-4 forbids it, since renaming breaks every client that reads `created`. They settle on what D-4
allows — the new name added beside the old, the old dropped only in /v2 — and the model writes D-5,
milestone M4 *Renamed fields* and its two units.

| # | Chat line (new) — **changed** | Caption (new) — **changed where marked** |
|---|---|---|
| 1 | **Person:** *Can we rename the API's created field to created_at? Every other date ends in _at.* | **Changed:** *A software project, built with a model one session at a time.* |
| 2 | **Model:** *D-4 says a published version never changes. Renaming created breaks every client that reads it.* | *The model answers from what the project already decided.* (as approved) |
| 3 | **Person:** *Fair. What rename does D-4 allow?* | — |
| 4 | **Model:** *Adding created_at beside created, and dropping created only in /v2. Writing it down as D-5.* | *The conclusion is written down, beside the decision it kept.* (as approved) |
| 5 | **Model:** *And the work: milestone M4, Renamed fields, in two units.* | — |
| 6 | **Model:** *M4 U1 can start now: what it waits on is built.* (as approved) | **Changed:** *The next session starts from these rows: what to build, and why this rename and not the other.* |

**The rows it writes, changed:**

- **decision D-5** · M4 · app · *A field is renamed by adding the new name beside the old, and the old goes
  in the next version* · question *How is a field of a published version renamed?* · answer *The new name
  is added beside the old, both with the same value, and the old name is removed only in the next
  version. Clients move when they choose to (D-4).* · live
- **milestone M4** · *Renamed fields* · goal *A field gets a clearer name without breaking a client that
  reads the old one.* · planned · position 4
- **unit M4 U1** · */v1 answers created_at beside created* · decision D-5 · planned · blocks M2 U2 (built)
- **unit M4 U2** · */v2 answers created_at alone* · planned · blocks M4 U1

**Also in F6, not words:** the newest chat line is outlined as it arrives — the app's outline, drawn
once round the line, at desktop and on the 375 card, whole under reduced motion — and an outline is
held only through the rows that only talk: a new scene, or a row that acts without outlining, lets go
of it before the ring sets off, so D-5's outline no longer stays over the roadmap after the click.
`check:tours` fails on an outline held over a box that has left the screen. The M4 U2 line, cut
about 15 px at 1280x800 under the old title, shows whole at 1280x800 and 1280x690, nothing in it
overflowing and 44 px of the sheet under it.
