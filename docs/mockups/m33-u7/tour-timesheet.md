# The timesheet tour: storyboard

**M33 U7, ported unapproved** (the driver, 2026-10-07: the author tests after, so there was no
storyboard stop). The shape is a real timesheet's, as given on 2026-10-07: one row per day —
date, start, end, hours worked out from them, an hour rate in money, and the day's earning worked out
as hours × rate — and the connection named with it: the days of a month earn that month's paycheck gross.
Every figure is synthetic and round; nothing comes from the real document.

**To watch it:** `npm run dev:demo` (port 4181), then
`http://localhost:4181/docs/mockups/m33-u2/host.html?tour=timesheet`, or full screen
`http://localhost:4181/?tour=timesheet&autoplay=1`.

## The question

*Was every hour I worked paid?* — *You keep your hours on a timesheet, and September's paycheck just
came. Does it pay for all of them?* The last caption answers it: yes, 14.5 hours, 870.00.

## The scenes, as they play

Six captions, 26 rows. The conversation panel (M33 F5) carries the first two scenes; the rest is the
app's own sheet and entry pages.

| # | Caption | What happens on the real app |
| --- | --- | --- |
| 1 | *September's paycheck is in the ledger. Your hours are only on paper.* | The ledger's Paychecks screen, *September 2026* outlined: gross 870.00 from *Weekend job*. The person asks whether it was right. |
| 2 | *The model writes the timesheet down as a format of its own.* | Two writes. **Timesheet day**: `date`, `start` and `end` (times), `rate` (money), and `paycheck`, a link **found by date in period**; `hours = end - start` and `earned = hours * rate` are computed. Then **added to the paycheck, no column of it touched**: a total `worked`, the sum of `earned` over its days, and the claim `hours_paid: gross = worked`. The rail grows *Timesheet day*; the ring opens it. |
| 3 | *Now the days, from the paper. It has no end time for the 14th.* | Typed at the sheet's foot: 7 Sep 09:00–17:00 at 60 (8 h, 480.00); 14 Sep from 09:00 at 60, no end. Each day finds *Weekend job* by itself. |
| 4 | *Without that end, the claim can't say yet: unchecked.* | The 14th's page, then its paycheck: `hours_paid` **unchecked**, outlined. |
| 5 | *From memory, you left at 13:30. Then it fails: 120.00 short.* | Back on the 14th, end 13:30, Enter; the paycheck: **failed**, 870.00 against 750.00. A visitor from 690 px can take over here and fix it; at 375 it is watched. |
| 6 | *Your calendar says 15:30. Every hour was paid: 14.5 hours, 870.00.* | End 15:30; the paycheck: **proved**, held for the loop. |

## Why it is a conversation and not the format editor

The first draft walked the editor, Connections and the paycheck's Claims band. **The paycheck's sheet
cannot be on the screen**: the ledger's paycheck is twenty columns, 2,620 px against 920, and the
check refuses a sideways scroll (M33 F1). Its Claims band lives only above that sheet, so a claim on
the paycheck has no screen the tour may show. A model declaring it is the same engine through
`declare_format` and `extend_format`'s words (D-227), and it is how the real timesheet was
worked out. The demo's `write` takes `{"declare": {…}}` for it (`src/demo/tour/declare.ts`).

## What the engine says, and what it could not

- **"The days of the paycheck's month" is a link, found by date** (D-350): one hop (D-224), filled on
  a write, stored. Nothing reads "same month" on read.
- **The claim sits on the paycheck's side**, because a total folds the rows that name it; the day has
  no way to fold its siblings. It adds a total and a claim, never a column (the pack's lock, D-269).
- **A paycheck with no days fails, not unchecked**: a sum of nothing is zero. In a real ledger every
  month before the timesheet began would fail `hours_paid`. The tour's document has one paycheck.
- **A day has no name**: the format has no text column, so where a day is listed (the paycheck's
  *Links here*) it shows its id.
