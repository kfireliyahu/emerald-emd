---
format: tour
title: Tour
language: 14
---

A tour of the demo (M33 U3, D-413): the real app, walked by a drawn ring, over a document of its own. This is what the strip says it is — a title drawn large and one line under it — and which document beside the app page it plays. Its rows are the steps of `tour_step`, which point here.

`scripts/make-demo-document.mjs` puts this file and `tour_step.format.md` into `tours.emd` beside the app page, as the two parts of a text document, and the frame reads them through the engine — so a step the engine cannot read is a demo that does not start, rather than a tour that stalls halfway. **The tours are not in the document they play**: a visitor's first screen there holds what the tour is about and nothing about tours.

The title is the question a visitor has, and the line says why they would have it (the author, 2026-10-07). The last caption of a tour answers the title. A tour whose pack has an answer rather than a question says it as a statement (the development tour, M33 F5).

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | yes |  |  |  | What the frame is asked for — `custom`, as `?tour=custom`. |
| title | text |  |  |  | yes | no |  |  |  | Drawn large at the top of the strip: the question the tour answers. |
| description | text |  |  |  | yes | no |  |  |  | One line under the title: why a visitor would ask it. |
| document | text |  |  |  | yes | no |  |  |  | The document beside the app page the tour plays, by name — `custom.emd`. |

## rows

### custom
title: Did the card charge what the receipt says?
description: You kept the receipt from the grocery store. The card statement came in. Do they agree?
document: custom.emd

### ledger
title: Where did this month's money go?
description: September's pay is in and the card statement just came. You want to know where it all went.
document: demo.emd

### development
title: Ask for a feature. The project answers first.
description: The model building your app reads what the project already decided, and writes down what you decide next.
document: project.emd

### timesheet
title: Was every hour I worked paid?
description: You keep your hours on a timesheet, and September's paycheck just came. Does it pay for all of them?
document: timesheet.emd
