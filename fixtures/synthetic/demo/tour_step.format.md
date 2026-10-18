---
format: tour_step
title: Tour step
language: 14
---

One step of a tour (M33 U3, D-413): an anchor on the real app, one thing a person would do there, and — on the step that starts a scene — the caption that scene shows. The runner in `src/demo/tour/` reads these in `position` order and knows nothing else about a tour, which is what lets a pack carry its own one day (M32).

**An anchor** is a `data-tour` name on one of the app's elements (`new-format`), `choice:<text>` for the option with exactly that text in an open list, or `row:<text>` for the sheet row with a cell holding exactly that text. **The ring points at `anchor`; the outline is drawn around `highlight`**, found after the step's action, so it can name what the action brought on screen, and held through the rows after it that only talk (`say`, `wait`): a new scene, or a row that acts without outlining, lets go of it (M33 F6). `scripts/check-tours.mjs` replays every tour at fast-forward in a real browser and fails on the first step whose anchor or highlight is not on the screen, or whose held outline is over a box that has left it.

**A caption starts a scene**: one dot in the strip, and the rows under it keep it until the next. A caption says what is happening and why it is a move toward the tour's question, never what the engine is. `beside` is a picture the frame shows beside the app for that scene (the paper being typed in), a file beside the document; the app never reads it, and no caption says it does.

**A tour told as a conversation** (M33 F5) carries a `chat` line on the rows where one is said, and `from` says whose. The frame shows them in a panel of its own in the paper's place — its header says the conversation was written for the tour, since the app has no chat on its screens — and a `write` row is the model writing what the conversation concluded: its `value` goes through the same `stageRows` and `insertRows` as `record_format_rows`, so a batch the engine refuses fails the step, and the check with it. A `write` whose value is `{"declare": {…}}` writes a format instead, as `declare_format` and `extend_format` are handed one (M33 U7): one the document does not hold is made, and one it holds — a pack's paycheck — is only added to, judged as the screens judge it. Nothing is painted into the page.

A step makes no claim.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tour | link | tour |  |  | yes | no |  |  |  | The tour this step is part of. |
| position | integer |  |  |  | yes | no |  | 1 |  | Where it plays in its tour, from 1. Gaps are allowed, so a step can be put between two. |
| anchor | text |  |  |  | no | no |  |  |  | Where the ring points and the action lands. Empty only for a `say` about nothing on the screen. |
| action | enum |  |  |  | yes | no | click, type, press, wait, say, write |  |  | What a person would do at the anchor. `say` holds the caption with the ring on the anchor; `wait` waits for the anchor and does nothing to it; `write` is the model writing rows, at no anchor. |
| value | text |  |  |  | no | no |  |  |  | What `type` types, character by character, the key `press` presses — `Enter` — or what a `write` writes, as JSON: `{"format": …, "rows": […]}`, what `record_format_rows` is handed, or `{"declare": {"format": …, …}}`, a format made or added to. |
| replace | boolean |  |  |  | no | no |  |  |  | `type` empties the field first. |
| caption | text |  |  |  | no | no |  |  |  | Starts a scene: the line the strip shows until the next caption. Held for its reading time before the scene's actions. |
| beside | text |  |  |  | no | no |  |  |  | On a scene's first step: a picture beside the app for the whole scene, by file name — `receipt.png`. |
| highlight | text |  |  |  | no | no |  |  |  | An anchor to outline once the action is done: the box the eye should be on, held through the rows after it that only talk. |
| chat | text |  |  |  | no | no |  |  |  | A line of the tour's conversation, new on this row: shown in the frame's own panel beside the app, written for the tour. |
| from | enum |  |  |  | no | no | person, model |  |  | Who says `chat`. |

| constraint | note |
| --- | --- |
| one row per tour, position | A tour plays its steps in one order. |
| anchor is required when action is click, type, press | Only a `say` or a `wait` may point at nothing. |
| value is required when action is type, press, write | A `type` says what it types, a `press` which key, and a `write` its rows. |

## rows

### nav-formats-card_charge
tour: custom
position: 1
action: click
caption: Here is the card statement. One of these is the grocery store.
highlight: row:CORNER MARKET

### nav-formats
tour: custom
position: 2
action: click
caption: To find out, describe the receipt: shop, day, total, and its charge.

### new-format
tour: custom
position: 3
action: click

### door-empty
tour: custom
position: 4
action: click

### format-title
tour: custom
position: 5
action: type
value: Receipt

### add-columns
tour: custom
position: 6
action: click

### column-name
tour: custom
position: 7
action: type
value: shop

### type-text
tour: custom
position: 8
action: click

### add-column
tour: custom
position: 9
action: click

### column-name
tour: custom
position: 10
action: type
value: date

### type-date
tour: custom
position: 11
action: click

### add-column
tour: custom
position: 12
action: click

### column-name
tour: custom
position: 13
action: type
value: total

### type-money
tour: custom
position: 14
action: click

### add-column
tour: custom
position: 15
action: click

### column-name
tour: custom
position: 16
action: type
value: paid_with

### type-link
tour: custom
position: 17
action: click

### points-at
tour: custom
position: 18
action: click

### choice:card_charge
tour: custom
position: 19
action: click

### create-format
tour: custom
position: 20
action: click

### claims
tour: custom
position: 21
action: click
caption: Then make a claim: the receipt's total is what the card charged.

### add-claim
tour: custom
position: 22
action: click

### claim-holds
tour: custom
position: 23
action: type
value: total = paid_with.amount

### save-shape
tour: custom
position: 24
action: click

### foot-shop
tour: custom
position: 25
action: type
value: Corner Market
caption: Now type the receipt in from the paper, and link it to its charge.
beside: receipt.png

### foot-date
tour: custom
position: 26
action: type
value: 2026-07-29

### foot-total
tour: custom
position: 27
action: type
value: 84.00

### foot-paid_with
tour: custom
position: 28
action: type
value: CORNER

### choice:CORNER MARKET
tour: custom
position: 29
action: click

### foot-paid_with
tour: custom
position: 30
action: press
value: Enter

### row-open
tour: custom
position: 31
action: click

### verdict-total_adds_up
tour: custom
position: 32
action: say
caption: They don't: the card was charged 12.00 more than the receipt says.
highlight: verdict-total_adds_up

### read-files
tour: ledger
position: 1
action: click
caption: The card statement just came. Until it is read, nothing here says where the money went.

### choice:card-statement-2026-09.xlsx
tour: ledger
position: 2
action: click

### read-file
tour: ledger
position: 3
action: say
caption: Every line read, and checked against the total the card printed.
highlight: read-file

### write-files
tour: ledger
position: 4
action: click

### choose-categories
tour: ledger
position: 5
action: click
caption: Last month's rules categorized every shop on it but one.

### merchant-category
tour: ledger
position: 6
action: click
caption: A studio it has never seen. Categorize it once, and a rule does it next month too.

### choice:Health & Fitness → Fitness
tour: ledger
position: 7
action: click

### merchant-confirm
tour: ledger
position: 8
action: click

### nav-home
tour: ledger
position: 9
action: click

### went-cat:groceries
tour: ledger
position: 10
action: say
caption: Groceries took the most: 3,428.30 of the 6,702.50, and every charge is categorized.
highlight: went-cat:groceries

### nav-formats-milestone-roadmap
tour: development
position: 1
action: click
caption: A software project, built with a model one session at a time.
chat: Can we rename the API's created field to created_at? Every other date ends in _at.
from: person

### nav-formats-decision
tour: development
position: 2
action: click
caption: The model answers from what the project already decided.
highlight: row:D-4
chat: D-4 says a published version never changes. Renaming created breaks every client that reads it.
from: model

###
tour: development
position: 3
action: say
chat: Fair. What rename does D-4 allow?
from: person

###
tour: development
position: 4
action: write
value: {"format": "decision", "rows": [{"ref": "D-5", "date": "2026-10-02", "milestone": "M4", "scope": "app", "title": "A field is renamed by adding the new name beside the old, and the old goes in the next version", "question": "How is a field of a published version renamed?", "answer": "The new name is added beside the old, both with the same value, and the old name is removed only in the next version. Clients move when they choose to (D-4).", "state": "live"}]}
caption: The conclusion is written down, beside the decision it kept.
highlight: row:D-5
chat: Adding created_at beside created, and dropping created only in /v2. Writing it down as D-5.
from: model

### nav-formats-milestone-roadmap
tour: development
position: 5
action: click
chat: And the work: milestone M4, Renamed fields, in two units.
from: model

###
tour: development
position: 6
action: write
value: {"format": "milestone", "rows": [{"ref": "M4", "title": "Renamed fields", "goal": "A field gets a clearer name without breaking a client that reads the old one.", "state": "planned", "position": 4}]}
highlight: roadmap-M4

###
tour: development
position: 7
action: write
value: {"format": "unit", "rows": [{"ref": "M4 U1", "milestone": "M4", "scope": "app", "title": "/v1 answers created_at beside created", "decision": "D-5", "state": "planned", "blocks": ["M2 U2"]}, {"ref": "M4 U2", "milestone": "M4", "scope": "app", "title": "/v2 answers created_at alone", "state": "planned", "blocks": ["M4 U1"]}]}
highlight: roadmap-M4

### line-M4 U1
tour: development
position: 8
action: say
caption: The next session starts from these rows: what to build, and why this rename and not the other.
highlight: line-M4 U1
chat: M4 U1 can start now: what it waits on is built.
from: model

### nav-paychecks
tour: timesheet
position: 1
action: click
caption: September's paycheck is in the ledger. Your hours are only on paper.
highlight: row:September 2026
chat: I keep a timesheet: each day's date, start, end and hour rate. Was September's paycheck right?
from: person

###
tour: timesheet
position: 2
action: write
value: {"declare": {"format": "timesheet_day", "title": "Timesheet day", "notes": "One day worked, as the paper timesheet has it.", "columns": [{"name": "date", "type": "date", "required": true}, {"name": "start", "type": "time"}, {"name": "end", "type": "time"}, {"name": "rate", "type": "money", "note": "The hour rate."}, {"name": "paycheck", "type": "link", "target": "paycheck", "found_by": "date in period", "note": "The paycheck of the day's month."}], "computed": [{"name": "hours", "works_out": "end - start"}, {"name": "earned", "works_out": "hours * rate", "note": "The day's gross earning."}], "widths": {"date": 104, "start": 72, "end": 72, "rate": 120, "paycheck": 140, "hours": 80, "earned": 112}}}
caption: The model writes the timesheet down as a format of its own.
chat: A timesheet day: date, start, end and rate. Its hours and its pay are worked out, never typed.
from: model

###
tour: timesheet
position: 3
action: write
value: {"declare": {"format": "paycheck", "aggregates": [{"name": "worked", "of": "sum", "over_format": "timesheet_day", "over_column": "paycheck", "works_out": "earned", "note": "What the month's timesheet days earned."}], "claims": [{"name": "hours_paid", "expression": "gross = worked", "note": "Every hour worked is in the gross."}]}}
chat: Each day finds the paycheck of its month. The paycheck adds up their pay and claims its gross is that.
from: model

### nav-formats
tour: timesheet
position: 4
action: click

### nav-formats-timesheet_day
tour: timesheet
position: 5
action: click

### foot-date
tour: timesheet
position: 6
action: type
value: 2026-09-07
caption: Now the days, from the paper. It has no end time for the 14th.

### foot-start
tour: timesheet
position: 7
action: type
value: 09:00

### foot-end
tour: timesheet
position: 8
action: type
value: 17:00

### foot-rate
tour: timesheet
position: 9
action: type
value: 60

### foot-rate
tour: timesheet
position: 10
action: press
value: Enter

### foot-date
tour: timesheet
position: 11
action: type
value: 2026-09-14

### foot-start
tour: timesheet
position: 12
action: type
value: 09:00

### foot-rate
tour: timesheet
position: 13
action: type
value: 60

### foot-rate
tour: timesheet
position: 14
action: press
value: Enter
highlight: row:2026-09-14

### row:2026-09-14
tour: timesheet
position: 15
action: click
caption: Without that end, the claim can't say yet: unchecked.

### link-paycheck
tour: timesheet
position: 16
action: click
highlight: verdict-hours_paid

### nav-formats-timesheet_day
tour: timesheet
position: 17
action: click
caption: From memory, you left at 13:30. Then it fails: 120.00 short.

### row:2026-09-14
tour: timesheet
position: 18
action: click

### field-end
tour: timesheet
position: 19
action: type
value: 13:30

### field-end
tour: timesheet
position: 20
action: press
value: Enter

### link-paycheck
tour: timesheet
position: 21
action: click
highlight: verdict-hours_paid

### nav-formats-timesheet_day
tour: timesheet
position: 22
action: click
caption: Your calendar says 15:30. Every hour was paid: 14.5 hours, 870.00.

### row:2026-09-14
tour: timesheet
position: 23
action: click

### field-end
tour: timesheet
position: 24
action: type
value: 15:30
replace: yes

### field-end
tour: timesheet
position: 25
action: press
value: Enter

### link-paycheck
tour: timesheet
position: 26
action: click
highlight: verdict-hours_paid
