# The ledger tour: storyboard

**M33 U5, approved by the author on 2026-10-07 with one change: the statement is English.** The
brief's five beats were Home on a lived-in document, Read a statement from a picker of bundled files,
the preview against the printed total, the unfiled shops filed with a rule, and a goal made in place.
The tour keeps the first four and **drops the goal**, because it does not answer the question below.
Both statements are made up and in English, and so is every shop on them, so a visitor who reads no
Hebrew can follow it; the figures below are the English statement's.

**To watch it:** start `demo-tour` (`npm run dev:demo`, port 4181), then open
`http://localhost:4181/docs/mockups/m33-u2/host.html?tour=ledger` — the host page, with both frames
playing this tour. Full screen: `http://localhost:4181/?tour=ledger&autoplay=1`.

## The question

The title is the question a visitor has; the line under it says why; the last caption answers it.

| | Title | Line under it | Last caption answers |
| --- | --- | --- | --- |
| **Chosen** | *Where did this month's money go?* | *September's pay is in and the card statement just came. You want to know where it all went.* | where: Groceries, 3,428.30 of 6,702.50 |
| Alt 1, not chosen | *Can I trust this month's numbers?* | *A total is only as good as the lines under it, and the card statement just came.* | yes: every line read, the card's own total matches, nothing unfiled |
| Alt 2, not chosen | *How much can I put aside this month?* | *The pay is in, the card statement just came, and there is an emergency fund to build.* | what was left over, and a goal made with it in place (the brief's fifth beat comes back) |

## The scenes, as they play

About 26 s at 1x, then the last caption is held 8 s and it loops. Five captions, no closing
*your turn* (Try it is in the strip).

| # | Caption | What happens on the real app |
| --- | --- | --- |
| 1 | *The card statement just came. Until it is read, nothing here says where the money went.* | Home on September: pay in, *Everyday Card ···1234 missing*, nothing waiting. The ring presses **Read files**; the demo's picker lists the one bundled file and the ring picks it. |
| 2 | *Every line read, and checked against the total the card printed.* | Read files: the file's row is outlined — *Adds up · 26 new · adds up to the printed ₪6,702.50*. The ring presses **Write**. |
| 3 | *Last month's rules filed every shop on it but one.* | Home: *Written: 26 transactions*, and one waiting answer, *1 transaction at 1 merchant needs a category*. The ring presses **Choose categories**. |
| 4 | *A studio it has never seen. File it once, and a rule files it next month too.* | By merchant: *Juniper Pilates Studio, no pattern yet, ₪249.00*. The ring picks *Health & Fitness → Fitness*; *rule* is ticked by default; **Confirm**; then Home. |
| 5 | *Groceries took the most: 3,428.30 of the 6,702.50, and every charge is filed.* | Home: *Where it went*, the Groceries row outlined; nothing waiting. |

## The document it opens

`demo.emd`, built by `scripts/make-demo-document.mjs` from `fixtures/synthetic/demo/ledger.json`,
**lived in a little**: last month's card statement (`card-statement-2026-08.xlsx`, charged 2 August,
25 lines, ₪6,483.75) is in and its columns are kept as the reader *Everyday Card*; no built-in
pattern knows a made-up shop, so every shop on it is filed by a rule; July to September's pay is in;
a goal and a debt; and the savings were counted on 1 September. (The shops on the card were said not
to be bills until M37 F2 taught the detector that the same shops on two statements are not evidence
of one; the marks are gone, and the six real bills on the card are offered once September is read.) The statement the tour reads, `card-statement-2026-09.xlsx` (charged 2
September, 26 lines, ₪6,702.50: the same shops, different figures, and one studio it has never
seen), is **not** in the document: it is bundled beside the page and listed in
`bundled.json`.

**The demo's one control of its own** is the picker (`src/demo/BundledFiles.tsx`): where the app
opens the system's file picker, the demo shows *Choose a file — Made-up files that come with the
demo* and lists the bundled files. What is picked is read by the app's own reading, unchanged. The
app's build does not contain it.

## What he chose (2026-10-07)

1. **The question**: the draft's title, line and five captions, as they stand.
2. **The goal**: dropped.
3. **The shop names**: English. Both statements and every shop the tour shows are made up and in
   English, and the new shop is an English-named studio, so a visitor who reads no Hebrew can follow it.
4. **The picker's words**: *Choose a file* and *Made-up files that come with the demo*, as they stand.
5. **The new shop**: a studio filed under Fitness, *Juniper Pilates Studio*.
