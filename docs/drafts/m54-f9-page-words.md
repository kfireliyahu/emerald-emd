# M54 F9 — the page's words, drafted for the pick

*Part 1 of M54 F9 (D-531, D-532). Nothing here is on the page yet. Pick a letter per row, mix
them, or write your own; part 2 puts the picks into `src/demo/page/copy/en.ts` and the README's
matching lines, and deletes this file. "Says" is what the line tells a stranger from one of
product.md's two crowds: **ledger** (money correct and private) or **engine** (a model's memory,
typed).*

## 1. The meta description — `description`

Now: "Emerald: Order to chaos using engineering"

- **A.** "Emerald, the database under the chat: a file on your machine that you and an AI model fill
  together, with real types and checks, so what you worked out stays true." Says: the README's own
  opening, for both crowds.
- **B.** "Emerald: a local database you and your AI assistant keep together. Every table typed,
  every total checked, nothing sent anywhere." Says: engine first, privacy last.
- **C.** "Emerald is the database under the chat. It reads your statements, receipts and notes
  into real tables, and says when they don't add up." Says: ledger first, the claim as the hook.

## 2. The hero story — `hero.story`

Now: "What is an application? Most are a database and a UI that exposes it. Most people now talk
to an AI chat instead, the new UI, and those chats have no reliable long-term memory. Emerald
closes that gap."

- **A.** "Emerald is a desktop app that keeps your own file: a real database that you and an AI
  model fill together. Hand it a card statement, a payslip or a project's notes, and it reads
  them into tables with real types, and tells you when something doesn't add up." Says: what it
  is and does; leads straight into the receipt question below it.
- **B.** "An AI chat is the new way to work with your data, but a chat forgets. Emerald is where
  it remembers: a database in a file on your machine, typed and checked, that you and the model
  fill together, starting with your money and your projects." Keeps your argument, ends on the
  two crowds.
- **C.** "For your money: it reads statements and payslips, and catches the charge that doesn't
  match. For your projects: it keeps what you and your AI decided, as rows the next session starts
  from. One file on your machine, with a real database underneath." Says: the two crowds, one
  sentence each.

## 3. The section order — the twelve rail rows

Now: What it is · The receipt · Where the money went · The project answers first · Every hour
paid · The engine · MCP · Packs · The ledger · The development pack · No internet, no login ·
Get Emerald

- **A. By crowd, the promise early.** What it is · No internet, no login · *ledger:* The receipt ·
  Where the money went · Every hour paid · The ledger · *engine:* The project tour · The
  development pack · The engine · MCP · Packs · Get Emerald
- **B. The tours together, then by crowd.** What it is · the four tours (receipt, money,
  timesheet, project) · The ledger · No internet, no login · The development pack · The engine ·
  MCP · Packs · Get Emerald
- **C. Each tour beside its section.** What it is · The receipt · No internet, no login · Where
  the money went · The ledger · Every hour paid · The project tour · The development pack · MCP ·
  The engine · Packs · Get Emerald

The tours' numbers (1-4) follow whichever order is picked.

## 4. One name per tour — rail row, label, frame title

Now: 1 'The receipt' / '1 · The receipt' / 'did the card charge what the receipt says?' ·
2 'Where the money went' / '2 · The ledger' / 'where did this month's money go?' ·
3 'The project answers first' / '3 · The development pack' / 'ask for a feature, and the project
answers first' · 4 'Every hour paid' / '4 · The timesheet' / 'was every hour I worked paid?'

The rule for all three letters: the rail row is the name, the label is "N · name", the frame
title is "Emerald, a guided tour: name".

- **A. What it finds.** The receipt · Where the money went · The project remembers · Every hour
  paid. Says: each tour's payoff.
- **B. What it works on.** The receipt · The month's money · The project's decisions · The
  timesheet. Says: plain nouns, the shortest.
- **C. The question.** Does the receipt match? · Where did the money go? · What did we decide? ·
  Was every hour paid? Says: the same voice as the heading above them, "Do my receipts line
  up…".

## 5. The four tour leads, one voice — `tours.*.lead`

Tour 1 and 4 already say *You*. Tour 2 now: "September's pay is in and the card statement just
came, I spent how much on groceries?!"

- **A.** "September's pay is in and the card statement just came. Where did the month's money go?"
- **B.** "Your pay is in and the card statement just came. How much of it went on groceries?"
- **C.** "September's pay is in, the card statement just came, and groceries look high. Were
  they?"

Tour 3 now: "You're working on a new app with an AI model. But you forgot what you decided
earlier. Recorded decisions become memory that is no longer ephemeral."

- **A.** "You're building an app with an AI model, and you've forgotten what you decided last
  month. The project hasn't: the decision is a row, and it answers first."
- **B.** "You're building an app with an AI model. You ask for a feature you ruled out weeks ago,
  and the project answers with the decision."
- **C.** "You're building an app with an AI model. Each decision is kept as a row, so the next
  session starts from it instead of from scratch."

## 6. The insider words, per line

**"The engine"** (rail row and heading)
- **A.** "How it works" · **B.** "Typed tables that check themselves" · **C.** "What keeps it true"

**"Claims: the receipt total is the card charge, every hour was paid. Each one proved, failed or
unchecked, and unchecked says why."**
- **A.** "Say what should add up (the receipt total is the card charge, every hour was paid) and
  each row shows whether it does: proved, failed, or unchecked with the reason."
- **B.** "Rules that should hold, checked on every row: the receipt total is the card charge,
  every hour was paid. An unchecked one says what's missing."

**"A model works in it, through MCP"** (heading; the rail row is "MCP")
- **A.** Heading "Your AI assistant works in it", rail "With your AI"; the first body line adds
  "through MCP, the standard way assistants connect to tools".
- **B.** Heading "A model works in it, through MCP (Model Context Protocol)", rail "Working with a
  model".
- **C.** Heading "Ask your assistant, and it reads and writes the file", rail "Your assistant".

**"Shaped tools, never a general query: 28 for any document, 85 with the ledger."**
- **A.** "The model gets named actions, never free rein over the database: 28 for any document,
  85 with the ledger."
- **B.** "The model can do only what a tool allows (add these rows, show that view), never run any
  query it likes."
- The count: a model in a host that honours tool visibility sees 27 and 84; `tools/list` says 28
  and 85 (the one more is the app's own view tool). Keep 28/85, say 27/84, or drop the figure (B).
  The figure is pinned by `toolCount.test.ts` with the README and `scripts/npm-package.mjs`.

**"became unit S4 U2: point the download link at /get"** (the inbox diagram)
- **A.** "became a task: point the download link at /get"
- **B.** "became the next piece of work: point the download link at /get"

**"It runs on the app's own Node."** (the Claude extension's card)
- **A.** "Nothing else to install."
- **B.** "It runs inside the Claude app, with nothing else to install."
- **C.** Drop the sentence.

## 7. Words from one country — the ledger and the engine

**"A year of study-fund reports read in: one month the fund received nothing, though the payslip
showed the deduction."** (also README)
- **A.** "A year of savings-fund reports read in: one month the fund received nothing, though the
  payslip showed the deduction."
- **B.** "One month the payslip took the deduction and the fund never got it. Emerald found it in a
  year of the fund's reports."

**"Where a paycheck went: every shekel followed, from gross to where it landed."**
- **A.** "Where a paycheck went: all of it followed, from gross to where it landed."
- **B.** "Where a paycheck went: nothing unaccounted for, from gross to where it landed."

**"Anything counts. Years of old accounts found in mail became one row each, and none was missed
when closing them."**
- **A.** "Anything you keep can be a table. Old accounts found in years of mail became one row
  each, and none was missed when closing them."
- **B.** "Not only money: forgotten accounts, dug out of years of mail, became one row each, and
  every one of them got closed."

## 8. One word for the thing — Packs beside The engine

Now: Packs says "A pack is formats somebody already worked out, with their views, ready to keep in
a document." The engine says "Declare a table for anything you keep: a charge, a paycheck, a book,
a milestone." The term rows: a **format** is a kind of thing, compiled to a real table; a
**table** is one of a format's views.

- **A. Format, defined once in The engine.** Engine: "Declare a format for anything you keep (a
  charge, a paycheck, a book, a milestone): its fields, stored as a real table with real types,
  not a template." Packs: "A pack is formats somebody already worked out, with their views, ready
  to keep in a document." Matches the README's "It is a *format*".
- **B. Kind of thing, no new word.** Engine: "Declare any kind of thing you keep…". Packs: "A pack
  is kinds of things somebody already worked out (a ledger's charges and paychecks, a project's
  decisions), ready to keep in a document."
- **C. Table everywhere on the page.** Packs: "A pack is tables somebody already worked out…".
  Plainest, but it disagrees with the term row, where a table is a view.

## 9. The engine's caption — `engine.caption`

Now: "Same receipt as the first tour, same finding. There you typed it in; here a model reads it,
and Emerald still says when it doesn't add up." (No model appears in the drawn card.)

- **A.** "Same receipt as the first tour: the lines arrive, the total and the charge follow, and
  the claim that they agree fails by 12.00." Says: exactly what plays.
- **B.** "Same receipt as the first tour. However its rows arrive (typed, read from a file, or
  written by a model) Emerald says when they don't add up." Keeps the point about a model,
  without claiming one is shown.
- **C.** "The first tour's receipt again. The claim is checked as each row lands, and fails the
  moment the total and the charge disagree."

## 10. The "No internet, no login" heading — `words.local.heading` and its rail row

The body stays: "Runs on your machine and sends nothing anywhere itself."

- **A.** "Runs on your machine"
- **B.** "Nothing sent, no account"
- **C.** "Your machine, your file"

## 11. Get Emerald — the lead and the order of the ways in

Now: "Five ways in, all free: the source, the Claude extension, the Claude plugin, the npm package
and the desktop app." On the page: the source, extension, plugin and npm cards, then "The desktop
app" and its three installers (the reader's own one filled since F8).

- **A. The app first, the source last.** Installers · Claude extension · Claude plugin · npm
  package · source. Lead: "All free. The desktop app for your own files; the Claude extension, the
  Claude plugin or the npm package to work in it with a model; or the source."
- **B. Two groups.** Installers, then under "To work with a model": extension · plugin · npm; the
  source last. Lead: "Free. Download the app, or add Emerald to the assistant you already use."
- **C. The engine crowd first.** Claude extension · installers · plugin · npm · source. Lead: "Five
  ways in, all free: the desktop app, the Claude extension, the Claude plugin, the npm package and
  the source."

## Also, from F8, not anyone's row

- The hero's button reads "Get Emerald" because it reuses `foot.heading`. Keep it, or give it a
  label of its own ("Download Emerald")?
- The ledger's "Files every charge" uses *file* for categorize, which D-451 retired: "Categorizes
  every charge, and tells a transfer from a spend…"? It is in the README too.
