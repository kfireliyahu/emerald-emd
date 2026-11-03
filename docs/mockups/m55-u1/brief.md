# M55 U1 — the input view, shaped

*Impeccable's shape (D-529), with D-533 as its discovery round:
what D-533 settles is not asked again, and where shape would have asked, the likely reading is
asserted. No mockup (maintainer, 2026-11-03). U3 and U4 build from this.*

> **Every line marked ▸ is the unit's pick, not yet the maintainer's** (D-535, as D-475 was the
> driver's). The maintainer said U1 does not wait for him; he judges the picks after, through the
> unit's open `review_entry`, and changing one later is a fix unit. Everything unmarked is D-533's.

## What exists today, tried on the demo

`npm run probe:screens` on `custom.emd` (`card_charge`: date, merchant, amount, all required) and
`project.emd` (`unit`), light theme, 2026-11-03:

- **entry/new** asks every required column on the entry's page — a title heading, the header line,
  figures — with *Add* and *Cancel* in a footer bar. Its date is the platform's date input and its
  title placeholder *A new card charge* is 2.44:1 (both U5's). After Add it opens the new entry:
  one row per visit, which is what M55 removes.
- **Quick add** (`ListView.tsx`, `EntryList.tsx`) takes a title and nothing else; its placeholder
  names every value it sets (*Add a task · inbox*, the term row).
- **The table's blank row** (`RowSheet.tsx`) fills defaults its own way — U2 makes the three share
  `entryDefaults`.
- **Add a block** (`Dashboard.tsx`, `MakeBlock.tsx`) offers saved views, rollups, *New view*,
  *New chart* and *Headline total*. A block is 1–4 grid columns wide (two on a narrow window) and
  2–20 rows of 40px high (D-527).
- **The rail** (`RailFolder.tsx`) lists a format's saved views (`filter` glyph) and charts
  (`chart` glyph) under it, each renamed and deleted where it stands.
- **There is no "format's +"** yet: the format screen's header has the filter, search, Read and
  *Add*; its tab strip ends with the rollups and, apart, Dashboard. The list beside an entry has a
  + (*Add a task*), which is "the list's +".

## 1 · Job and audience

A person with many rows of one kind to put in by hand — a card's charges off a paper slip, a day's
tasks, a week's readings — who today goes Add → fill → Add → back, once per row. Mode: **Operate**.
The job is typing: the hands stay on the keys, the eyes on the paper. Second job, rarer: shaping the
form once so that every later row is two fields and Enter.

## 2 · Outcome and proof

- Five card charges in a row without leaving the form: type, Tab, type, Enter, five times.
- Nothing taken silently: whatever the form sets without asking is named on it.
- A wrong value is said at its field, every one at once, before anything is written.
- The proof is D-533's done-tests: U3's *Card charge* made from + and used for Add, U4's block and
  quick add with Tab — and a conversation's `record_format_rows view:"Card charge"` doing the same.

## 3 · Selected direction

Inside the established world (tokens, `rule` rows); no new visual language. **The input view is
entry/new made light**: the same field pieces (U5's, U6's link field), laid out for typing many rows
rather than reading one, in the same place entry/new opens — beside the format's list — and with the
same footer bar.

- ▸ **It is a page, not a tab.** It opens where entry/new opens, beside the format's list (hidden by
  the same button), at its own address under the format; its way back is the one link to the view
  it came from (the *detail is a page* rule). It is **not** a tab of the format's strip: a tab is a
  way of *seeing* rows, and this is a way of *adding* them. Rejected: a tab beside the saved views
  (it would sit among views of rows and leave the list behind).
- ▸ **The fields are one wrapping row of labelled fields**, each at its type's width (a date or an
  amount narrow, a text or a link wide), the label above in the label style, in the view's order,
  at most the entry's measure. Not the entry's layout of title heading, header line and figures
  grid: that is for reading one row.
- ▸ **The footer bar is entry/new's**: *Add* (the primary, its `add` tile) then the *Adds as* line
  in `ink-secondary`, the values in `ink`. No Cancel: there is nothing to cancel; the way out is the
  back link.
- ▸ **Under the form, the rows just added** (§6).

## 4 · Scope and boundaries

In: the form (U3), making and editing it in place (U3), the rail row and glyph (U3), the + (U3),
the dashboard block (U4), quick add with the view's fields inline (U4). Out: the engine (U2), how a
field refuses and how a date is typed (U5), the link field's *+ New* (U6), the parked ledger's
screens (D-533). Anti-goals: a form builder (per-field hints, sticky values, sections — D-533
rejected the table they would need); parsing quick add's text; a second shape of `views.md`.

## 5 · States and ranges

Fields asked: 1 to the format's every column (typical 2–5). Values set but not asked: 0–5. Rows
added in one visit: 1–50.

- **No input view.** Add, the list's + and quick add are as today; the + offers *New input view*.
- **Input views but none used for Add.** Each opens from the rail; Add is entry/new.
- ▸ **A required column the view neither asks nor sets** (the format gained it after the view was
  saved): the form asks it last, marked *needed* as entry/new marks it, and one line above the
  fields says *This view does not ask amount, which every card charge needs* with the action
  *Ask it here*, which adds it to the view. Saving such a view on screen is refused (U2's refusal,
  said at the field's row in Fields).
- **A link with no match** — typed: U6's *No account is called "Visa"* and *+ New "Visa"*, in the
  form as in entry/new. ▸ A **set** link whose row has since gone: its value in the *Adds as* line
  is struck and `negative`, *No account is called "Visa" now*, and Add refuses with it, beside any
  field problems — every problem at once.
- **A date word.** ▸ A date field whose default is a word shows the day it names, written as the
  table writes it (U7), with the word after it in `ink-secondary` — *2026-11-03 · today* — and is
  worked out again at every reset, so a form left open past midnight takes the new day. Typing
  replaces both. In the *Adds as* line it reads *date today*. A range word (*this week*) is refused
  as a default at its cell: *A default names one day: today, yesterday, tomorrow or a date.*
- **Read-only** (the frame, a locked document, a format a pack writes): the form drawn with its
  fields disabled and no Add; no *New input view* where no row can be written.
- **A claim that fails on a row just added**: the row is written (a claim never refuses) and its
  line in *Just added* carries the failed verdict's chip.
- Hebrew values go through `Bidi`, in the fields, the *Adds as* line and *Just added*.

## 6 · Interaction and layout

### The form

- **Focus** goes to the first field on opening and after every Add (D-533). The maker puts the
  field typed first, first.
- ▸ **Enter adds** from any one-line field; in a field of several lines, Ctrl+Enter. In a link or
  choice field whose choices are open, the first Enter picks and the second adds. Tab walks the
  fields, then Add; Shift+Tab back.
- **After Add** (D-533): every asked field goes back to its default, or empty — nothing typed is
  kept — and focus goes to the first field.
- **A refusal** is at its field: outlined `negative`, its sentence under it (U5's words: *No
  milestone is called "M9"*), every problem at once; nothing is written, what was typed stays, and
  focus goes to the first refused field.
- ▸ **Just added** — a label over the rows added from this form in this visit, newest first, each
  drawn as the list draws it (title, then its line), the title opening the entry. Each ends in an
  **Undo** icon (`IconAction`, the `undo` glyph, named *Undo adding Lunch spot*), which deletes that
  row: it shrinks out (the *row grows in and shrinks out* rule). If another row now links to it,
  Undo refuses at that line: *Kept: 2 rows link to it.* The list is the visit's: leaving the form
  empties it, since the rows are in the format. No Ctrl+Z: it would fight a field's own text undo.
- ▸ **One primary per screen**: while the form is on screen, the format header's Add is not drawn —
  it would open the page it is on.

### Making one, and editing it in place

- ▸ **The format's +** is an `IconAction` at the end of the format's tab strip, after the rollups
  and before Dashboard's hairline. Its menu: **New input view**, **New view**, **New chart** — the
  last two the forms Add a block already has (`ViewForm`, `ChartForm`, D-525), saved without placing
  a block. One place to make a format's views; a + with one item would be a wasted click.
- ▸ **New input view** opens the form as a draft: it asks every required column in the format's
  order, its name field holds the format's title (*Card charge*, or *Card charge 2* when taken —
  inferred, only confirmed), and **Fields** is open beside it. The draft's bar: the name, the
  **Use for Add** tick, **Save** (the primary until saved, then Add takes its place), Cancel. Escape
  or Cancel discards it.
- ▸ **Fields, for an input view**, is the entry's Fields list (M53 U2) with two columns in place of
  *Shown* and *New entry*: **Ask** (a tick) and **Default** (a value cell, typed as the field is —
  a member, a link by its name, a number, money, text, or a date or date word). Rows dragged by the
  grip set the order. A row neither asked nor defaulted on a required column says at its row
  *needed: ask it or give it a default*, and Save is refused naming each such row. Asked with a
  default: the field starts holding it. Default without Ask: it is on the *Adds as* line.
- After saving, the same **Fields** button and **Use for Add** tick sit in the form's bar; a change
  there is saved as it is made (a saved view is its address). Renaming and deleting are the rail's.

**Click paths**, from the format's table (a click or Enter is one; typing is none):

| To | Today | Here |
|---|---|---|
| An input view of the required columns, used for Add | — | 4: +, New input view, Use for Add, Save |
| *Card charge*: merchant and amount asked; date today and account Visa set; used for Add | — | 6: +, New input view, date's Ask, account's Default choice, Use for Add, Save |
| Add five card charges | 20: per charge Add, the date, Add, back | 6: Add, then Enter per charge |
| Undo one just added | 3: open it, its menu, Delete | 1 |
| Open the input view later | — | 1: its rail row (or Add, when it is used for Add) |

### In the rail

- ▸ **Under its format, first**: input views (the one used for Add first), then saved views, then
  charts. Its glyph is **`input`**, new: a field's box with a text caret. Its title reads *Card
  charge — an input view*. The one used for Add ends with the caption **Add** in `ink-secondary`,
  where a format's row has its count. Rename and Delete where it stands, Delete asking once (D-526);
  deleting the one used for Add says *Add opens the entry form again.*

### On a dashboard (U4)

- ▸ **The block is the form**, live: its title the view's name, which opens the full form; under it
  the sentence *Adds a card charge as account Visa · date today* — *Adds a card charge* alone when
  it sets nothing. The fields, then **Add as a secondary button**: a dashboard of several blocks is
  one screen, and one primary per screen. Enter adds, as on the page.
- ▸ **At F4's sizes**: one column wide, the fields stack one per 40px row with the label at the left;
  two to four wide, they wrap in one row as on the page. The *Just added* rows fill what height is
  left, newest first, with Undo; those that do not fit are not drawn (they are in the format). A
  block shorter than its fields scrolls inside itself with Add held at its foot.
- ▸ **Add a block** lists the format's input views with its saved views, and **New input view** with
  *New view* and *New chart*, made in place (the same Fields, inline) and placed in one step; on the
  document's dashboard, *Of* asks the format first. *Remove from this dashboard* leaves the view.

### Quick add with the view's fields (U4)

- ▸ Where the format has an input view used for Add, quick add's line is **that view's asked fields
  in its order**: the first takes the placeholder (*Add a card charge · <what it sets>*, as the term
  row says), the others follow inline, each a compact field with its column's name as a small label
  before it (never a placeholder alone: the probe counts those). Tab crosses them; Enter adds with
  the view's defaults; Esc clears them all. Nothing is parsed from the text (D-533).
- ▸ **A group wins**: quick add in a group takes the group's value for that column over the view's
  default, and a field asking the grouped column starts holding it.
- ▸ **Beside an entry** (the narrow list), the first field is the line; the others open under it, one
  32px row each, while the line has focus or holds text.
- After Enter, the line goes back to its defaults and the row appears in the list itself — no *Just
  added* here: the list is right there.

## 7 · Constraints and open decisions

- Both halves (D-227) are U2's: `arrange_views` makes, renames, deletes and marks; `record_format_rows
  view:` uses; `show_format view:` draws read-only. Nothing here adds a write.
- The rules this leans on: one primary per screen; an action is a verb; words name the rule; make
  it in place; choices are `ChoiceField`; a row grows in and shrinks out; an icon is an action;
  keyboard first; Hebrew through `Bidi`. None is bent.
- **Terms a later unit must correct when it lands** (they become false then, not now): *Re-apply*
  says it is "the only undoable action in the app" (U3's Undo); *Saved view* lists its kinds without
  input (U3); *Block*'s three kinds gain the form (U4); *Add a task · values* gains the view's
  fields (U4).
- Not decided here and not to be invented by U3/U4: how a set link is stored (by id or by name) is
  U2's; how a field refuses and how a date is typed are U5's; *+ New* is U6's.

## The new words

Checked against the `term` rows first (2026-11-03): nothing holds *input*, *default*, *ask*, *just
added* or *undo* on the engine's screens; *Undo* appears only in the ledger's *Re-apply* and *Run*.
Each pick is a `term` row (named by D-535) and is SETTLED in U3's and U4's briefs.

| What | Drafts | ▸ Pick, and why |
|---|---|---|
| The kind, on screen | **Input view** · Form · Add form | **Input view** — D-533's own name and the milestone's; *Form* is one word for two things (entry/new is the entry form); *Add form* ties it to Add, which only one of a format's input views opens. |
| What it sets but does not ask | **Adds as** *account Visa · date today* · Also sets … · Every row gets … | **Adds as** — D-533's wording, and it reads beside *Add*; *Also sets* names the mechanism, not the row. On a block it opens a sentence: *Adds a card charge as …*. |
| The + menu's items | **New input view · New view · New chart** · New input view alone · Input view… · View… · Chart… | **New input view, New view, New chart** — the verb and its object, as Add a block's *New view* and *New chart* already read. |
| Marking it the one Add opens | **Use for Add** · Default · Opens with Add | **Use for Add** — says what it changes; *Default* does not say of what, and *default* is already the word for a field's value. The rail and the bar mark it with the caption **Add**. |
| Fields' two columns, for an input view | **Ask · Default** · Asked · Default value · Prefill | **Ask** and **Default** — one word each, as *Shown* and *New entry* are. |
| The rows just added | **Just added** · Added here · Added now | **Just added** — the visit's rows, which is all it covers. |
| Taking one back | **Undo** · Remove · Take back | **Undo**, named *Undo adding <title>* — the verb for reversing what was just done; *Remove* reads as *Remove from this dashboard*. |
| A required column the view lacks | *This view does not ask amount, which every card charge needs* · *Ask it here* | As written — the sentence names the column and why; the action is the verb. |
