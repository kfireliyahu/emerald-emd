# M59 U1 — a new ledger document, shaped

*Impeccable's shape (D-529), with D-575 as its discovery round: what D-575 settles is not asked
again, and where shape would have asked, the likely reading is taken. No mockup. U6 builds from
this, after U2–U5 have landed.*

> **Every line marked ▸ is the unit's pick, not yet the maintainer's** (D-535's way, as M55 U1's
> were). He judges them after, through this unit's open `review_entry`; changing one before U6
> starts is a brief edit, after it a fix unit. Everything unmarked is D-575's or what exists.

## What exists today, tried as she met it

A new document keeping only the ledger (`create_document packs:[ledger]`, `.demo/new-ledger.emd`),
opened in the demo build and measured with `npm run probe:screens`, 2026-11-11:

- **The rail has twelve places** before anything is read: Home (Month, Year), Dashboard,
  Transactions, Paychecks, Plan, Wealth, Categories, Formats (the ledger's twenty formats under
  *The ledger*), Connections, Agenda, Assistants, Settings. Eight of them have nothing to show.
- **A dialog opens by itself**: *A new document. Walk through where things go?* with *Guide me* and
  *Not now* (U5 removes it, D-575).
- **Home** is the header (*Home · Month*, h1 *Month*), the intake band (*Drop statements, paychecks
  and fund reports here, any number*, *Add by hand*, *Read files*), the line *Getting started, 0 of
  7 done. Next: drop statements, paychecks and fund reports here.* with *Guide me* and *Put this
  away*, and a paragraph that says the band's sentence again.
- **Transactions** with no rows is one centred sentence with no heading (no h1, the probe) and no
  action. Once it has rows its header, figures and filter bar hold **thirteen controls** before the
  first row: All rows / By merchant, Rules, the month pager (2), All months, Export all to CSV,
  search, Account, Category (which lists *Uncategorized* twice, M54 U5), At least, At most, and a
  strip of every category's sum.
- **By merchant** opens on three platform `<select>`s (Account, Month, Order), four tiles (one of
  them a red *₪0.00* when nothing waits) and *Skip all n* before the first merchant.

## 1 · Job and audience

Someone opening Emerald for their own money for the first time — not the maintainer — with a card
or bank export in hand and no idea what a format, a pack or a deduction type is. Mode: **Learn,
then Operate**. The job is three things in order, D-575's three workflows: **read a statement**,
**categorize** what it holds, **see where the money went**. Everything else (paychecks, a plan,
wealth) is a second visit, once there is something for it to work on.

## 2 · Outcome and proof

- From a new document to *where the money went* with no screen that has nothing on it.
- The rail names only places that hold something, or the three workflows' own.
- The proof is U6's done-test, and the maintainer's eye with his friend after it (U6's MAINTAINER'S
  EYE): a new empty ledger document shows what is below, and each held-back place appears once the
  document holds what brings it back.

**The three paths, counted in clicks from a new document** (a file is chosen in the system's own
dialog, which is not counted; dropping the file on the window saves *Read files*):

| Workflow | Path | Clicks |
|---|---|---|
| Read a statement, a reader already knows it | Home: *Read files* → choose → the read screen: *Write* | 2 (1 by drop) |
| Read a statement of a new shape | *Read files* → choose → *Map its columns* → confirm → *Write* | 4 (3 by drop) |
| Categorize | Home after *Write*: the waiting line *n transactions at m merchants need a category* → By merchant; per merchant a guess already there: *Put all n in X* (1), or choose (2) then put (1); every guess at once: *Save n* (1); a provider category (U3): one click for every merchant under it | 1 to arrive, then 1–3 a merchant |
| See where the money went | *Write* lands on Home, whose month holds *Where it went* by category; a category opens its rows on Transactions | 0 (1 to a category's rows) |

▸ None of these paths gets a new step: they exist and are short. What made them hard to find was
everything around them, so the picks below take away rather than add.

## 3 · Selected direction

Inside the established world (tokens, the `rule` rows); no new visual language. **A new ledger
document shows the three workflows' places and holds back the rest until the document has
something for them.** Held back is hidden, not removed: every route still opens (as a hidden
place does today, `nav.ts`), and a conversation loses nothing (the rail is presentation; nothing in
`src/parity.test.ts` changes).

## 4 · Scope and boundaries

In (U6): the rail's held-back places and what brings each back; Home's first screen; the controls on
Transactions and By merchant that move behind a menu; where Getting started sits. Out: the two-card
read (U2), By merchant's provider category and left-out rows (U3), 50 / 30 / 20's proposal (U4), the
page that scrolls into blank, Guide me opening by itself and the Dismiss on Getting started (U5);
Hebrew (M60). Anti-goals: a wizard or a first-run flow of screens; a "simple mode" switch; any
change to what a document holds or to a tool.

## 5 · States and ranges

**The rail, for a document that keeps the ledger.**

- ▸ **A new ledger document's rail is five places**: Home (Month only), Transactions, Categories,
  then past the hairline Assistants and Settings. Twelve today.
- ▸ **What holds each back, and what brings it back** — computed from the document each time it is
  drawn, never remembered, so a place returns the moment its first row exists:

| Place | Comes back when the document holds | Why that |
|---|---|---|
| Home › Year | transactions in two or more calendar months | a year of one month is the month again |
| Paychecks | a paycheck | the band on Home reads a paycheck's PDF and *Add a paycheck* types one, so nothing needs the place first |
| Plan | a plan, a bill, or a month with rows and nothing in it left uncategorized | a plan divides spending by category; until a month is categorized it divides nothing (U4's proposal reads those months) |
| Wealth | a goal, a debt, a fund or fund report, an account with holdings, a place kept by hand, or an account's opening balance | each is what one of Wealth's four pages lists |
| Dashboard | a block on the document's dashboard | an empty dashboard is a page with nothing on it |
| Formats, Connections | a format of the person's own, or a pack other than the ledger | the ledger's formats are the ledger's screens already; Formats is where a person's *own* kinds of thing live |
| Agenda | a dated format of the person's own, or of a pack other than the ledger | as today it waits for a dated format, but the ledger's dates are Transactions' |

- ▸ **A held-back place you stand on takes its line in the rail while you are there**, lit as any
  page is — so Getting started, the palette, a link on another screen or a bookmark never lands on a
  page the rail does not show. Today a hidden place takes no line (`nav.ts`, M20 U0).
- ▸ **The command palette lists every place, held back or not.** No switch to show every place:
  the palette and Getting started reach them, and a switch is one more control for the person this
  is for.
- ▸ **The maintainer's documents and demo.emd are unchanged** except Formats, Connections and Agenda,
  which a ledger-only document now holds back: the demo's tours are checked (`check:tours`) and a
  tour that walks to one of them stands on it, which shows it.

**Home.**

- ▸ **Before anything is read**, Home is the header, the intake band (its *Read files* the screen's
  one primary), and Getting started under it — nothing else. The paragraph *Nothing here yet. Read a
  card or bank statement…* goes: it said the band's sentence again, and the band is the empty state.
- ▸ **The band's *Add by hand* becomes *Add a paycheck*** (what it adds; its title already says *A
  paycheck, typed in*).
- ▸ **After a statement is read**, the order stays as built: the band, Getting started, the waiting
  list (the categorize line first among its items when it is there — it is workflow 2's way in), the
  month's figures, the chart, *Where it went*, *All months*. ▸ The *Taxes* figure is left out while
  the document holds no paycheck (it can only say *no paycheck for this month*); with paychecks and
  none this month it stays as now.

**Getting started** (Home's GuideLine; D-575: its steps are the guide's, ticking themselves).

- ▸ It sits **under the band, one line**, as now; *Guide me* opens the guide only when pressed (U5),
  and the line's own *Dismiss* (U5) puts it away for the document.
- ▸ **The step it names next is a link to that step's place** (the screen, without the guide), so a
  held-back place is one click from Home when Getting started is what sends you there.
- ▸ **Its order puts the workflows first**: *Drop statements…*, then *Give each shop a category,
  once*, then *Make the list of categories yours*, then the plan, the bank and the cushion as now.
  Today the categories' list comes before the shops, which asks a new person to edit a list of
  forty-two names before they have seen one of their own charges.

**Transactions** (the rows view). A first-time person needs: the view switch (*All rows · By
merchant*), the month pager and *All months*, search, and the figures.

- ▸ **Behind one *Filter* button**, beside search: Account, Category, At least, At most, and *Clear*.
  The button carries how many are on (*Filter · 2*). Category lists *Uncategorized* once (M54 U5).
  Each is a `ChoiceField`, never a `<select>` (M54 U5's row on the filter bar's Category).
- ▸ **Behind the header's *More* menu (⋯)**: *Rules* and *Export these n to CSV* (Rules is also a
  tab of Categories; Export is also Settings › Export).
- ▸ **The figures are three**: Went out, Came in, No category (its link to By merchant as now).
  *Left out of totals* shows only when a row is left out. They are ink, not the flow colours, which
  are Home's alone (M54 U5's row on the flow colours off Home).
- ▸ **The strip of every category's sum goes**: *Where it went* on Home is that list, and a
  category there opens these rows filtered.
- ▸ **With no rows**, the page keeps its header (h1 *Transactions*) and its empty state is one
  sentence and one text action: *No transactions yet.* · *Read files*.
- Stay as built: the card-payments question, the rule-applied and selection bars (they appear only
  on an act), the row's context menu, the counts line.

**By merchant.** A first-time person needs: the merchant list, each row's category field and *Put
all n in X*, *Skip for now*, the provider category's action (U3), and *Save n* for the guesses.

- ▸ **Account and Month behind the same *Filter* button** as Transactions; **Order** moves to the
  list's header row (*Merchant*) as a menu on its right (*Most charges first*), since an order is
  not a filter.
- ▸ ***Skip all n* moves into the header's *More* menu (⋯)**; *n skipped* stays where it is, since
  it is how skipped merchants come back.
- ▸ **Two tiles, not four**: *Waiting* (names, and under it *n charges, ₪x without a category*) and
  *Categorized this sitting*. The red *Without a category ₪0.00* is gone with its tile (M54 U5's row,
  U3's to fix if it lands first).
- ▸ **With nothing read**, one sentence and one text action: *No transactions yet.* · *Read files*.
- Stay as built: *Make a rule as you confirm*, the row's *More* menu, *Your usual categories*.

## 6 · M54 U5's open findings this takes

Only where U6 reworks the screen and a new person meets it (D-575):

- **The flow colours off Home** (Transactions' Went out / Came in tiles) — ▸ ink, above.
- **Category lists *Uncategorized* twice**, and the filter bar's platform `<select>`s — ▸ in *Filter*.
- **No h1** on an empty Transactions — ▸ above.
- **A transaction's pane shows the natural key raw** (*Recognised on re-import as
  2026-07-24␟20890ILS␟…*, `DetailPanel.tsx:381`) — ▸ the line goes; it is the first pane a new
  person opens.
- Left to their screens' own units: By merchant's red figure and `<select>`s (U3), Plan's (U4),
  Wealth's and Paychecks' (held back for a new document, and no M59 unit reworks them).

## 7 · Constraints and open decisions

- **The rail is presentation.** Nothing a person can do is lost to a conversation, and no tool
  changes (`src/parity.test.ts`).
- **Tours**: holding back Formats, Connections and Agenda in a ledger-only document touches the
  demo; `npm run check:tours` runs in U6.
- **The widest pick** is holding back Formats, Connections and Agenda in a ledger-only document:
  the engine's own places, in the product whose engine is the point. The narrower answer is to hold
  back only the ledger's places (Year, Paychecks, Plan, Wealth) and Dashboard, leaving the rail at
  nine.
- **Plan's trigger** (a fully categorized month) is the pick most likely to feel late; the
  looser one is any categorized row, which after the first read is almost always true.

## The new words

Term rows written by this unit (`format_rows term search:"D-577"`): *Getting started*, *Add a
paycheck*, *Filter*. Existing words kept: *Read files*, *Where it went*, *By merchant*, *Categorize*,
*More*.
