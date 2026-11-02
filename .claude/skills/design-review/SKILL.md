---
name: design-review
description: Review one of Emerald's screens for design — its look, layout, type, colour, contrast, focus, words and states — against the live ui rule rows, on the demo documents in light and dark, writing each finding as an open review_entry row and fixing plain rule breaches in place. Use in this repository whenever asked to review, critique or audit a screen, a surface, a view, a page or a milestone's screens ("review the agenda screen", "critique the board", "audit the intake screens", "does the rail look right"), even when the request names /impeccable or web-design-guidelines — this skill says how those run here. Not for the review phase, where the maintainer judges a built milestone's open rows (that is review-phase), and not for a code review of a diff.
---

# Design review

How M54 (D-530) reviewed every surface, kept to what its eight units found worked. **The rules
themselves are rows, not this file** (D-437): read them, never restate them.

## 0. Start the walk first, then read

The walk is the slow part (7-21 minutes); everything else fits inside it. So, before reading anything:

1. `preview_start demo-tour` — `npm run dev:demo`: it builds the demo documents from synthetic
   sources and serves them. **Use the port it reports** (4181 is often held by an earlier session's
   server). Documents: `app.html?document=custom.emd|project.emd|demo.emd#/<route>`; `demo.emd` and
   `timesheet.emd` keep the ledger, `custom.emd` has none, `project.emd` is the development pack's.
   `tours.emd` holds the tours. **Never a working `.emd`** — real names and figures would reach the
   rows (D-390).
2. **Start the critique walk at once** — `/impeccable critique`'s Assessment A — as **one background
   general-purpose subagent** with a self-contained brief:
   - the surface, its routes and documents, and the port; *wait for the first load*;
   - *fetch the ui rules yourself* (`format_rows rule match:{scope:ui, state:live} columns:[name, statement] limit:120`);
   - *open your own tab with `tabs_create`*; *leave `fc-theme` on light* when done
     (`localStorage.setItem('fc-theme','dark'); location.reload()` switches it; the tab shares it);
   - both themes at a desktop width, and no other condition unless asked;
   - *edits may land while you walk* (your HMR reloads, not another writer);
   - *never run the detector, never edit, never save; cancel every dialog*;
   - return numbered findings: route, what it does now, what it should do, the rule, P0-P3, and
     `ENTRY` on any about entering a row by hand.
   - To feed a file without a picker: the dev server serves `/fixtures/synthetic/<file>` — fetch it
     into a `File`, put it in a `DataTransfer`, set `input[type=file].files`, dispatch `change` (bubbles).
   - **A moving surface (a tour, an animation) is watched by sampling state in JS** every ~150 ms,
     never by screenshots, which lag seconds behind. That is how U8 found a P0 `check:tours` could not.
3. Then read: `format_rows rule match:{scope:ui, state:live} columns:[name, statement] limit:120`,
   [DESIGN.md](../../../DESIGN.md) and [PRODUCT.md](../../../PRODUCT.md), and the earlier rows on
   the surface to dedupe against (`format_rows review_entry search:"<route or file>" columns:[unit, do, breaks]`).

## 1. While it walks: the audit by hand

`/impeccable audit`'s dimensions, done in code — this found more than the walk did for type, tokens
and `<select>`s.

- **One grep script over the surface's files** (Write it and run it by path, `< /dev/null`; heredocs
  with backticks fail to parse): `<select`, `<datalist`, `text-[Npx]`, `-[Npx]` spacing, hex, `rgb(`,
  `bg-white`, `outline-none`, `transition-all`, `autoFocus`, `rounded`, `shadow`, `ink-tertiary`,
  `onClick` on a non-button. Count per file; never trust a truncated `head`.
- **Add the surface's files to `REVIEWED` in [`surfaceRules.test.ts`](../../../src/ui/formats/surfaceRules.test.ts) early**,
  and names that come out of a document to `DOCUMENT_STRINGS`. The guard caught what every grep
  missed, in every unit. A new check goes in the same file, and **run it against the parent
  commit's file to see it fail** — a Python-written regex once silently matched nothing.
- **One `javascript_tool` call per question, over every route**: headings (`h1,h2,h3`), controls
  with no name (count a wrapping `<label>` as a name), contrast of each text token on each plane
  with `data-theme` flipped inside the same call. A ratio of 1.00 means the variable did not
  resolve — reuse an earlier figure.
- **`web-design-guidelines`**: one WebFetch of its `command.md`, applied to the same grep output.

## 2. Verify, fix the plain, record the rest

- **Check every one of the walk's claims in code before it becomes a row** — U1 found 2 of 18 false.
- **A plain breach of a live ui rule row is fixed in place**, with a guard that fails without it.
  Anything that needs judgement, changes layout on the public page, or changes what a tour does is
  recorded, not fixed — and **the ledger is parked: there, record only**.
- **Wrapped a name in `Bidi`?** Run `npx vitest run src/ui/bidiTruncation.test.ts`: the ellipsis
  belongs on the `Bidi` span, not a box around it (U4's broke CI).
- Then `npx vitest related <changed files> --run`, `npx vitest run src/ui/formats/surfaceRules.test.ts src/privacy.test.ts`,
  `npm run typecheck`; `npm run check:tours` in the background only if a tour passes through it.
- Prove a fix with `read_page` / `get_page_text` / `javascript_tool`. **A screenshot only when the
  answer is visual**, with the preview's tab fronted (a hidden tab has a 0×0 viewport, and
  focus and blur fail there — read compiled CSS instead).

## 3. The detector, once

At the end, never per edit: `sh ~/.claude/plugins/cache/impeccable/impeccable/*/skills/impeccable/scripts/impeccable detect --json <files>`
(`sh`, not `node`; it is not on PATH). **It found nothing in all eight M54 units** — the rule rows,
the guard and the hand audit found everything. Run it because it is cheap; do not lean on it. If
per-edit findings start appearing after your edits, `/impeccable hooks off`.

## 4. The rows

**Each finding is an open `review_entry` on the unit that found it**, written inside its `land_units`
call (`review_entries`) with `commit: true` after checking the draft yourself — one call, no dry-run
resend. `formats review_entry` has the columns.

- `do` — the document, the route and the action: *Demo, custom.emd, #/formats/card_charge/read → drop bank-statement.csv outside the box.*
- `should` — what it should do, with the rule's name in brackets.
- `breaks` — what it does, then `file:line`. One about entering a row by hand **starts `Entry:`**
  (M55 is planned from them). A question for the maintainer — two rules disagree, or a rule and the
  screen — says so.
- `not_tried` — what the review did not reach.

Keep each row short: long rows push `docs/memory.emd` past `encoding.test.ts`'s text-to-bytes bound.
Count the rows before writing their numbers into the report.

## The shell

The window chrome, menus, dialogs and notices: [verify-in-shell](../verify-in-shell/SKILL.md),
after `npm run build` and `npm run build:electron`. Launch with both `--remote-debugging-port=9222`
and `--inspect=9229` (the main process: `process.mainModule.require('electron')` dumps the menu as
text, records and answers every `dialog.show*`, sends `emerald:documents/command` and
`emerald:updates/changed`), the document's path last, a scratch `--user-data-dir` — and
**`EMERALD_BACKUPS_DIR` set to the scratchpad before launching**, or Back up now writes into the
maintainer's real Backups folder. The critique subagent there reads code only, so two drivers never
share one window. Native caption buttons and the Alt menu bar are out of reach.
