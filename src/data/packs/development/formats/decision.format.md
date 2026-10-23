---
format: decision
title: Decision
language: 13
claims: none
---

One decision the project made, as a row: what was undecided, what was decided, when, and whether it still stands. A decision log kept as prose grows until nobody reads it end to end, and then the same question gets decided again, differently, by somebody who did not know it had been answered. A row is found by asking — `search:"caching"`, `match:{state:live}` — rather than by reading.

**A decision others already rely on is not changed in place.** When it stops being true, a later decision supersedes it: the new row names the old one in `supersedes`, and the old one's `state` becomes `amended` or `superseded`. That is why there is no field to overwrite, and why the history stays readable. Correcting the wording of a decision the same day it was written is fine; changing what it says once others have acted on it is not.

`question` and `answer` are the two halves every decision has. Kept apart, a session can be handed the answer alone and act on it, and go and read the question when the answer is not enough.

`ref` is the name people use for the decision — `D-12` — and is not the row's `id`, which every table already has and which a link resolves through.

A decision makes no claim: its rules are "not empty" and "this link resolves", which the columns already enforce.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | The decision's own name, as the project writes it — `D-12`. Not the row id. |
| date | date |  |  |  | yes | no |  |  |  | The day it was decided. |
| milestone | text |  |  |  | yes | no |  |  |  | The milestone it was decided in — `M2`. Text rather than a link, so a decision can name a milestone this document does not hold. |
| scope | text |  |  |  | yes | no |  |  |  | Which part of the project it governs — `api`, `web`, `docs`, or whatever the project's own parts are called. Split by what the decision governs, not by the milestone it came out of, so a filter on it shows one part's rules and nothing else's. |
| title | text |  |  |  | yes | no |  |  |  | The decision in one line, as a sentence — `Orders are kept for seven years`. |
| question | text |  |  |  | yes | no |  |  |  | What was undecided before this — the thing a later session would otherwise decide differently by accident. |
| answer | text |  |  |  | yes | no |  |  |  | What was decided. Enough on its own that a session need not read the argument to act correctly. |
| supersedes | link | decision |  |  | no | no |  |  |  | The earlier decision this one replaces or amends — `D-7`. Empty for a decision that changes nothing before it. |
| state | enum |  |  |  | yes | no | live, amended, superseded |  |  | Whether this is still the decision of record. `amended`: a later decision changed part of it and the rest still stands. `superseded`: a later decision replaced it. A decision others rely on is never rewritten, so this column is how to ask. |

## rows
