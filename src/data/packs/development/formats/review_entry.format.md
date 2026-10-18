---
format: review_entry
title: Review entry
language: 4
claims: none
---

What a unit session left for the maintainer to drive: docs/review.md, which reached 1,214 lines and thirty entries with no way to ask which four were live. That file is frozen as of D-238 and this format is what sorts it.

`state` is the column whose absence made the graveyard, and it is the whole reason this format exists rather than the prose staying prose. Thirty entries with no state is a queue nobody can triage; thirty rows with one is four `match` calls. The finding review.md was built on still stands — four real documents, and nothing else, ever rewrote this design — and what failed was the deferral, not the writing down.

An entry is deliberately four prose columns rather than one body. `do`, `should`, `breaks` and `not_tried` are the four questions the file's own template asks, and separating them is what lets a session be handed `breaks` alone: "where nothing checked it" is the half that predicts the next expensive bug, and it was buried in the middle of a bullet list.

`unit` is required. An entry with no unit is a note, and this project already has somewhere to put notes.

A review entry makes no claim — which is gap #1 of the four D-238 predicted, met for the second time in this document.

| column | type | points at | unit | per | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unit | link | unit |  |  | yes |  |  |  | The unit this is about. Required: an entry with no unit is a note rather than something to drive. |
| do | text |  |  |  | yes |  |  |  | The screen, the route and the file to open, in order. Named by route and file, never by "the screen you added" — the reader has no memory of the work. |
| should | text |  |  |  | yes |  |  |  | The figure, the row, the message. Precise enough to be wrong, which is the only kind of claim a review can reject. |
| breaks | text |  |  |  | no |  |  |  | Where it breaks, usually wherever nothing checked it. Said plainly. This is the column worth reading on its own. |
| not_tried | text |  |  |  | no |  |  |  | What could not be tried in the session that built it, and why — a real document, a running model, a Mac. |
| state | enum |  |  |  | yes | open, accepted, fault, dropped |  |  | **The column whose absence made the graveyard.** `open` has not been driven or was outranked and still stands. `accepted` was driven and holds. `fault` was driven and is wrong, and work follows from it. `dropped` stopped mattering — usually because the milestone it belonged to stopped. |

## rows
