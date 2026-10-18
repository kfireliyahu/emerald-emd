---
type: log
project: Emerald
pack: ledger
---

# Decision log — the ledger pack

**An index, not an archive.** The full entries of finished milestones are kept privately, and
every decision is a `decision` row in `docs/memory.emd`; this file is
the half of the index that belongs to the ledger, separated from
[the core log](../../09-decision-log.md) on 2026-09-16 when finance became a pack. Nothing was
rewritten and no number changed, so a reference to any D-number still resolves from either side.

**The ledger is parked.** These are the decisions of a product that was built, used against real
documents, and found four times over to be hiding a more general thing — see
[`README.md`](./README.md) for what state it is in and what is still worth testing.

A decision taken *during* a finance milestone whose rule turned out to govern the engine is
indexed in the core log instead: the reading traps (D-142 to D-153), the confirm surface (D-205,
D-206), the review phase (D-198), the plugin's shape (D-092 to D-104).

---

## Index

| # | Date | Decision | Where |
|---|---|---|---|
| D-004 | 2026-08-09 | Signed amounts with an explicit direction field | M0–M1 |
| D-006 | 2026-08-09 | Statistics default to charge date | M0–M1 |
| D-007 | 2026-08-09 | Installments are counted per charged slice | M0–M1 |
| D-008 | 2026-08-09 | First-match-wins rule resolution | M0–M1 |
| D-009 | 2026-08-09 | Manual assignments are permanent | M0–M1 |
| D-011 | 2026-08-09 | Balances are always derived, never stored | M0–M1 |
| D-014 | 2026-08-09 | Card settlements matched by last-4, excluded on the user's say-so | M0–M1 |
| D-015 | 2026-08-09 | Long-term funds are their own aggregate, not savings goals | M0–M1 |
| D-016 | 2026-08-09 | Onboarding creates real records, and is built in M1 | M0–M1 |
| D-029 | 2026-08-10 | Category depth is a database rule, and it needed a second half | M0–M1 |
| D-032 | 2026-08-10 | Filtering is a SQL question, and the total belongs to the filter | M0–M1 |
| D-033 | 2026-08-10 | A card is identified by the number the file states, never by its file name | M0–M1 |
| D-034 | 2026-08-10 | Onboarding produces records as it goes, and merge is what makes an account repairable | M0–M1 |
| D-035 | 2026-08-10 | An installment's purchase total is not a foreign amount, and the currency is what says so | M0–M1 |
| D-036 | 2026-08-11 | A transaction has two dates, so the mapper offers two | M2 |
| D-037 | 2026-08-11 | The rule engine is a pure comparator, and three specified fields are not columns | M2 |
| D-038 | 2026-08-11 | A suggestion is decided once, at staging, and counted once, at commit | M2 |
| D-039 | 2026-08-11 | The currency is read off the amounts, and the fallback is not a guess | M2 |
| D-040 | 2026-08-11 | The rules screen shows the order, not the numbers, and the test box is the engine | M2 |
| D-041 | 2026-08-11 | A rule is written from a row, and the row says which rule wrote it | M2 |
| D-042 | 2026-08-12 | A learned rule claims exactly what it saw, and the audit keeps the facts rather than the interpretation | M2 |
| D-043 | 2026-08-12 | The offer asks what to match on, and asks it where the user is looking | M2 |
| D-044 | 2026-08-12 | The specification is reconciled with the build, and two departures are ratified | M2 |
| D-045 | 2026-08-12 | Re-apply assigns and does not retract, and it is the only thing that can be undone | M2 |
| D-046 | 2026-08-13 | Built-in rules ship with the app, and the document holds only opinions about them | M2 |
| D-047 | 2026-08-13 | Bulk categorize is one decision per shop, and it can only ever fill in a blank | M2 |
| D-048 | 2026-08-13 | One deduction type, two amount columns, and the slip is never argued with | M3 |
| D-049 | 2026-08-13 | The built-in deduction types are rows, and D-046 does not generalize | M3 |
| D-050 | 2026-08-13 | The strip reports and never refuses, and the form is where the typing lives | M3 |
| D-051 | 2026-08-13 | The waterfall always reaches net, and a gap in the trend is a gap | M3 |
| D-052 | 2026-08-13 | The flags are the screen, and a refusal explains itself | M3 |
| D-053 | 2026-08-13 | A candidate is not a row, and a dismissal is not a table | M4 |
| D-054 | 2026-08-13 | Sections with sub-navs, and the top nav gets shorter | M4 |
| D-055 | 2026-08-13 | Variance is a column, and silence means two different things | M4 |
| D-056 | 2026-08-13 | Buckets are shared, the vocabulary is complete, and two fields were one | M4 |
| D-057 | 2026-08-14 | The splitter has no Save button, and the template is a starting point | M4 |
| D-058 | 2026-08-14 | Applying a plan suggests, and the target it writes has an editor | M4 |
| D-059 | 2026-08-14 | A drag may raise a plan's total, and a row is identified by its bucket | M4 |
| D-060 | 2026-08-14 | A class is derived, a settlement is a group, and the last-4 was being eaten | M5 |
| D-061 | 2026-08-14 | The answer is a column, the link is a table, and a sync never overwrites either | M5 |
| D-062 | 2026-08-14 | The rescan runs after every commit, and the test is the property | M5 |
| D-063 | 2026-08-14 | The balance check is stored as one JSON value, and it blocks with a way past | M5 |
| D-064 | 2026-08-14 | The settlement prompt is a queue on the account screen, not a strip on the review screen | M5 |
| D-065 | 2026-08-14 | The labeling queue was already built, and what it was missing was "skip" | M5 |
| D-066 | 2026-08-14 | A deposit is never a gain, and the guarantee is a parameter | M5 |
| D-067 | 2026-08-14 | Two tables, no contribution table, and the foreign key stays unwritten | M5 |
| D-068 | 2026-08-14 | Wealth is a route until it has a second screen, and the benchmark is shown while it is typed | M5 |
| D-069 | 2026-08-14 | The user can name the card a merchant pays, and a stale link now goes away | M5 |
| D-070 | 2026-08-14 | An imported file is not always a card, and an account's kind is editable | M5 |
| D-071 | 2026-08-14 | The verdict is a sentence and the table is its working | M5 |
| D-072 | 2026-08-15 | The section gets a sub-nav, the projection gets a home, and a slider may not disagree with its own number | M5 |
| D-073 | 2026-08-15 | The link is a column on the row that stores it, offered where the money is still yours | M5 |
| D-074 | 2026-08-15 | A balance is a signature, liquidity belongs to the place, and a rate says whose it is | M5 |
| D-075 | 2026-08-15 | Three tables with no balance in them, and a line id does not survive an edit | M5 |
| D-076 | 2026-08-15 | Savings leads the section, deposits are a view, and three identical columns are worse than one | M5 |
| D-077 | 2026-08-15 | One destination per line, and a plan that proposes a deposit | M5 |
| D-078 | 2026-08-15 | The salary is the duplicate, and the answer is a month | M5 |
| D-079 | 2026-08-15 | The picker offers four groups, and two of them do not make accounts | M5 |
| D-080 | 2026-08-15 | The provider's own heading is a rule you can write, behind the editor and not on one click | M5 |
| D-081 | 2026-08-15 | Money that was already there, and money the market made, are in the balance and are not saving | M5 |
| D-082 | 2026-08-15 | A projected balance nobody can decompose is a number taken on trust | M5 |
| D-083 | 2026-08-15 | A debt has no balance, a payment states its interest, and the payroll link already exists | M6 |
| D-084 | 2026-08-22 | A dismissal removes a claimant, not a payment | M6 |
| D-085 | 2026-08-22 | One question per line, and the kind decides which one | M6 |
| D-086 | 2026-08-22 | Promoting the purchase is the confirmation | M6 |
| D-088 | 2026-08-22 | A rolled-up total has to drill into a rolled-up ledger | M6 |
| D-105 | 2026-08-24 | A swatch grid rather than a colour wheel, because the palette knows about the second theme | M6–M7 |
| D-107 | 2026-08-24 | A net worth of what the document knows, which is not everything you own | M6–M7 |
| D-108 | 2026-08-24 | Home is the root, it computes nothing, and it is ordered by consequence rather than by count | M6–M7 |
| D-111 | 2026-08-24 | The detector had been built for four milestones and the conversation could not ask it anything | M6–M7 |
| D-112 | 2026-08-24 | The payslip and the fund report are one question, and neither half was reachable | M6–M7 |
| D-113 | 2026-08-24 | The two things no file contains: what you are saving for and what you owe | M6–M7 |
| D-116 | 2026-08-24 | M8 is deleted, and M6.5 loses the three lines that were not hardening | M9 |
| D-121 | 2026-08-25 | The plugin's rule writer was asking the wrong question about what rules exist | M6.5 |
| D-151 | 2026-08-27 | A merchant is suggested from the user's own history, and the suggestion names its neighbour | M10/M11 |
| D-157 | 2026-08-28 | The nav follows the order a person gets ready in, and a view of a screen is not a place | M13/M14 |
| D-158 | 2026-08-28 | The picker that files a transaction is the picker that makes the category | M13/M14 |
| D-159 | 2026-08-28 | A price arrives the way every other number does — transcribed. D-124 stands | M13/M14 |
| D-160 | 2026-08-28 | The settlement queue was complete and had never been asked | M13/M14 |
| D-161 | 2026-08-28 | A category's colour is a fact about the level it is drawn in, not about the category | M13/M14 |
| D-162 | 2026-08-28 | A taxonomy screen has to say which categories are dead, or merge and archive are guesses | M13/M14 |
| D-166 | 2026-08-28 | Onboarding asks for the documents in the drawer, and stops setting the user homework | M13/M14 |
| D-169 | 2026-08-28 | The salary a deposit was computed on is a third figure, and neither document checks it | M13/M14 |
| D-174 | 2026-08-28 | The bar is the control, and the fixed expenses are a figure rather than a clause | M13/M14 |
| D-175 | 2026-08-29 | A place is where money sits, a holding is what it sits in, and only the second has a return | M15 |
| D-176 | 2026-08-29 | A balance says how it is known, and that is the money map's third column | M15 |
| D-177 | 2026-08-29 | A fund is a row on the money map and a record of its own | M15 |
| D-179 | 2026-08-29 | A milestone that says "seamless" never closes, so M17 is five edges and one view | M16–M17 |
| D-180 | 2026-08-29 | The four things building M15 settled that its three decisions did not | M15 |
| D-181 | 2026-08-29 | A position is a holding, so every figure M15 built already knows about it | M16–M17 |
| D-182 | 2026-08-29 | A quantity is an integer of millionths, for the reason money is an integer of agorot — `valueOf` moved to `core/price.ts` in **D-204** | M16–M17 |
| D-183 | 2026-08-29 | Cost basis is a moving average, and there is one method rather than a setting | M16–M17 |
| D-184 | 2026-08-29 | A rate is a stored record with a date, because a position is the case D-003 did not cover | M16–M17 |
| D-185 | 2026-08-29 | Investments is a place in Wealth, because a portfolio asks four questions the map has no column for | M16–M17 |
| D-186 | 2026-08-29 | A valued holding's balance is its valuation, and the goal matrix totals goals rather than places | M16–M17 |
| D-187 | 2026-08-29 | The price provider is one host, symbols rather than ISINs, and unmapped is the default | M16–M17 |
| D-188 | 2026-08-29 | A holdings table is a deposit table, and the rung that always terminates is pointing at it | M16–M17 |
| D-189 | 2026-09-02 | M17's first edge was built by M6, so the milestone is four edges and a view | M16–M17 |
| D-190 | 2026-09-02 | A plan writes a debt payment, and the row it writes says what the app would have found anyway | M16–M17 |
| D-191 | 2026-09-03 | The queue's two promotions are one question, and the debt half writes no payment | M16–M17 |
| D-192 | 2026-09-03 | The import review's rule offer is a scoped re-run, and it fills blanks rather than arguing | M16–M17 |
| D-193 | 2026-09-03 | The trace view is a list of arrows whose useful half is the ones that stop | M16–M17 |
| D-194 | 2026-09-03 | A real broker statement read nothing, and the four assumptions that made it so | M16–M17 |
| D-195 | 2026-09-03 | The security number is a key and gets a column, because a ticker was never one | M16–M17 |
| D-196 | 2026-09-04 | A trades table is a sequence of dated events, which is what rejoins its split rows | M16–M17 |
| D-197 | 2026-09-04 | A cost basis is shown as the walk that produced it, on a screen rather than in a pane | M16–M17 |
| D-199 | 2026-09-04 | The add-position form asks for the key its statement prints, and editing is not adding | M16–M17 |
| D-200 | 2026-09-04 | A trade names the money that paid for it, and the difference is the answer rather than an error | M16–M17 |
| D-201 | 2026-09-04 | Investments get a first-run step, and the app records an intention rather than offering one | M16–M17 |
| D-202 | 2026-09-04 | A refusal to price a security is a sentence, and the mapping that refuses is the one that says why | M16–M17 |
| D-203 | 2026-09-04 | The statement's own arithmetic checks the reading, and a check that could not run says so | M16–M17 |
| D-204 | 2026-09-05 | A price is not an amount: it carries six digits past the minor unit, and the value is where the rounding happens | M16–M17 |
| D-207 | 2026-09-05 | The plugin gets investments, and the conversation that transcribes a statement is checked by the statement's own arithmetic | M16–M17 |

---

## Related

[README](./README.md) · [core decisions](../../09-decision-log.md)
