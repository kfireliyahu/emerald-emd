---
format: review_entry
title: Review entry
language: 4
claims: none
---

Something a session that built a unit leaves for a person to try: what to open, what should happen, and where it is likely to break. Tests say the code does what the session believed; only somebody trying it says the feature is right, and that is easy to put off until nobody remembers what each note was about.

`state` is why this is a format rather than a list in a file. A list of thirty entries with no state is a queue nobody can triage; thirty rows with one is a `match` call for the four still open.

An entry is four prose columns rather than one body. `do`, `should`, `breaks` and `not_tried` are the four questions a good hand-over answers, and keeping them apart lets a session be handed `breaks` alone — where nothing checked it, which is the part that predicts the next bug.

`unit` is required: an entry with no unit is a note, not something to try.

A review entry makes no claim.

| column | type | points at | unit | per | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unit | link | unit |  |  | yes |  |  |  | The unit this is about. Required: an entry with no unit is a note rather than something to try. |
| do | text |  |  |  | yes |  |  |  | What to open and do, in order — the page, the command, the file. Named exactly, never "the screen you added": the reader has no memory of the work. |
| should | text |  |  |  | yes |  |  |  | What should happen — the figure, the row, the message. Precise enough to be wrong, which is the only kind of claim a review can reject. |
| breaks | text |  |  |  | no |  |  |  | Where it breaks, usually wherever nothing checked it. Said plainly. The column worth reading on its own. |
| not_tried | text |  |  |  | no |  |  |  | What the session that built it could not try, and why — a real file, a device, an account it had no access to. |
| state | enum |  |  |  | yes | open, accepted, fault, dropped |  |  | `open` has not been tried yet. `accepted` was tried and holds. `fault` was tried and is wrong, and work follows from it. `dropped` stopped mattering — usually because the work it belonged to stopped. |

## rows
