# The recording: a model does the reading

The AI half of Emerald's page (M33 U8), drafted beside the mockup in M33 U8a and moved here when
the page was ported (`demo-page.html`, `src/demo/page/`). **A proposal: the
maintainer records it, and every word below can change.** 60 to 90 seconds, no voice-over
needed; the captions carry it. Same receipt as the custom tour, same finding, and the point of
the recording is the one thing the tour cannot show: nobody types the receipt in.

On the page it goes in **The engine**'s row, where the claim that plays itself stands in for it
until it exists (M33 F10).

## What is on screen

Two windows side by side: a Claude Code session on the left, Emerald on the
right with `custom.emd` open on the `card_charge` sheet (the demo's document, `dist-demo/custom.emd`,
or a copy of it). The receipt is `fixtures/synthetic/demo/receipt.png`: Corner Market, 29 July,
four lines (Bread 12.00, Milk 8.00, Eggs 24.00, Coffee 40.00), total 84.00. The card charge that
paid it is CORNER MARKET, 96.00.

The window is the app, not the tour: no ring, no strip. The model's writes land on the open sheet
the way any write from a conversation does, so the right-hand window needs no touching.

## The shots

| When | Left: the conversation | Right: Emerald | Caption (on the page's player, or burned in) |
|---|---|---|---|
| 0:00 | The receipt image is dropped into the prompt with one line: *Read this receipt into my document, and check it against the card.* | The `card_charge` sheet: three rows, CORNER MARKET 96.00 among them. | **The receipt, as a photo. No typing.** |
| 0:08 | The model calls `formats` on the document and reads back `card_charge`; then `declare_format` for `receipt` (shop, date, total, charge → card_charge) and `receipt_line` (receipt → receipt, item, price), with the claim `total = sum of lines` and the identity `total = charge.amount`. The dry run prints the plan. | Nothing yet. | **It asks the document what it already has, and declares what the receipt is.** |
| 0:25 | `declare_format … commit: true`. | `receipt` and `receipt_line` appear in the rail. | **A format is a real table with real checks.** |
| 0:32 | `record_format_rows receipt` with the four lines read off the photo, the total 84.00, and the charge linked to CORNER MARKET; dry run, then commit. | The receipt row lands on its sheet; the four lines under it. | **It reads the paper. Shop, day, four lines, the total.** |
| 0:50 | The model's answer: *The lines add up to 84.00, which is what the receipt prints. The card charged 96.00.* | The claim column: `total = sum of lines` **holds**; `total = charge.amount` **failed, off by 12.00**, in negative. | **The receipt adds up. The card does not: 12.00 more than the paper says.** |
| 1:00 | Hold on the answer. | Hold on the failed claim. | **The model did the reading. Emerald still said when it was wrong.** |

Cut at 1:05 to 1:20 depending on how fast the calls return.

## Rules the recording keeps

- **The model produces a mapping, a position or a declaration, never a value it invented**
  (D-132, D-137): every figure in the document is one printed on the receipt. The 84.00 is
  read, not computed by the model; the sum is the claim's.
- **Nothing promises more than the app does.** The caption says the model *reads*; it does not
  say the data never leaves the machine. The photo went to the model's provider, and the
  recording's page says so beside it (M33 U8's privacy line).
- **Real documents never enter the repo** (D-390): the receipt is the synthetic one the tour
  already draws, and the document is the demo's.
- **No competitor is named** (D-450): the left window is Claude Code, a host Emerald runs inside,
  which the rule allows.

## What is still open

- Whether the two formats are declared in the recording (0:08 to 0:25, which shows the engine's
  half) or are already there when it starts (shorter; the recording is only the reading). The
  tour declares its format live, so the recording may skip it.
- Whether the claim's two verdicts are read aloud or only captioned. The mockup assumes captions.
