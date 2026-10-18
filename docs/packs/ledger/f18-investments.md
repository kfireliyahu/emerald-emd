---
type: feature
project: Emerald
feature: F18
milestone: M16
---

# F18 — Investments

> [!warning] Removed in M28 U1 (D-308)
> Investments left the ledger whole — the broker statement reader, its holdings and trades tables,
> `TableMapper` and the price fetch with them. This note is the record of what was built, not of
> anything the app does now.

**An investment account was a number you typed in.** Indistinguishable from a savings envelope:
no security, no ISIN, no quantity, no cost basis, no composition
([08 C-F1](./08-suggestions-and-open-questions.md)). M16 gives it all of them, on the two shapes
this project has already built twice — F13's transcribe-then-reconcile, and
[F17](../../mapping-templates.md)'s ladder for reading a document, whose tabular half is exactly a
holdings table.

It rests on M15. **A position is a holding** (D-181), cash in the account is a holding, and the
transfer in is an ordinary `SavingDeposit` landing in the cash one. They reconcile rather than nest.

## The records

Six tables, migration `025`. [04 Data Model](./04-data-model.md)'s *Investments* section has the
columns; this is what each is for.

| Record | What it is |
|---|---|
| `Security` | The instrument, keyed on its ISIN **or its `מספר נייר`** (D-195) — the second is the only identity a Tel Aviv statement prints. **A label, not an amount** — no price, no quantity, no value, so two accounts holding the same ETF share one record of what it is. |
| `SecurityPosition` | 1:1 with a `SECURITY` holding: which security, how many units, and when that count was last true. |
| `SecurityPrice` | What one unit was worth on one day, and where the number came from — `TRANSCRIBED`, `TYPED` or `FETCHED`, stored identically (D-178). |
| `SecurityTrade` | The purchase history, when the user has it. Optional in the strongest sense: a position without one still has a quantity, a price and a value. Since M16 U2 a statement's `פירוט תנועות` writes these, through `upsertTrade` so a second overlapping statement moves nothing. |
| `PurchasePlan` | What you plan to buy. An intention, like a `SplitBucket`, and it writes nothing. |
| `fx_rate` | A rate belonging to a date (D-184). The only way two currencies meet in this app. |

## What the shape buys, and it is the point of D-181

A position **is** a `Holding`, so on the day the migration lands, with no new code:

- `is_liquid` means the right thing per position — a money-market fund and an index fund at one
  broker can differ, which is what D-175 added the column for.
- `expected_return_bp` with basis `ASSUMED` is *"what you assume it earns"*, and `projectSavings`
  already compounds each holding at its own rate.
- `fee_bp` is an ETF's expense ratio.
- `provenance = 'VALUED'` with `last_confirmed_at` is already the sentence Home's attention list
  says about a figure nobody has checked (D-176).
- The money map lists it under its place, the liquidity split divides it, net worth sums it.

**A `VALUED` holding's balance is not Σ its deposits.** It is units times a price, and
`holdingBalances` takes a valuation that *replaces* the sum (D-186) — the deposits that bought the
units are the same money in an earlier form. That is the one place the savings model and the
investment model have to agree, and `documentPortfolio` is where they are joined: cash from
`savings.ts`, positions from `investments.ts`, neither computing the other's number.

**The valuation reaches the places and not the goals.** A position's market value belongs to where
it is held; it belongs to a goal only through the deposits that bought it, so `inGoals` stays Σ the
deposits while `liquidity.total` carries the valuation. The same asymmetry F13's funds have had
since D-074. The money map's goal matrix therefore totals **the goals in a place** rather than the
place itself.

**Nothing may import in a circle.** `savingsRepository` imports `investmentRepository` for
`holdingValuations`; the two calls that need the reverse — `createPosition`, which writes a holding,
and `documentPortfolio`, which needs the cash — live in `portfolioRepository.ts` above both.

## The rules the arithmetic keeps

1. **A value is never handed in, only computed.** No function in `domain/investments.ts` takes a
   value or a total as a parameter. The one exception is `CashRow`, and it is an exception because
   that balance belongs to `savings.ts` — the file that is allowed to sum deposits, and the only one.
2. **"No price" is a variant, not a zero.** A security nobody has quoted is `UNPRICED`; a position
   in a currency the document cannot convert is `UNCONVERTED`. Both are named in
   `PortfolioReport.gaps` and both stay out of the total. **A portfolio that under-reports itself
   because a fetch failed is the specific failure a price fetch must not be able to cause.**
3. **Cost basis is a moving average and there is one method** (D-183). No FIFO, no lots, no setting.
   `oversold` and `quantityDisagreement` are reported rather than smoothed over.
4. **What the statement printed wins over what we can recompute.** A trade's `consideration`, where
   it exists, is the money that moved.
5. **Reconciliation has three states**, `AGREES` / `DIFFERS` / `UNCHECKED` — D-149's shape, and
   D-138's law met again: a statement that printed no total cannot be agreed with. `hasGaps` is on
   the result because an `AGREES` reached with something missing from the sum is the dangerous half.

## Reading an investment statement

Through F17's ladder, with the label-value half for the account and its printed total and the
tabular half for the holdings table — rows with no labels, a count that changes every statement,
found by shape against a heading anchor (D-153, D-188). The format is stored as a
`DocumentTemplate` of kind `INVESTMENT` at schema 26 and reused (D-139, D-149, D-164).

**All three rungs exist.** A stored format is executed with no model; a local model derives one
through the `investment-statement` task; and **the third rung is `TableMapper`** — click the line
above the table, say what each column holds, and watch the row count as you do. That rung had to be
built rather than borrowed: a payslip's is the paycheck form, but a statement is a table of thirty
rows and retyping it is not a fallback anybody would use, so this one asks for the *format* instead
(D-188).

**The columns are counted off the rows, not off the heading** (D-194). A real heading wraps and
fragments, so the first statement this rung met had seven-cell rows under a heading whose widest
line was five cells — and every row failed the count test whatever the user pointed at.
`tableShapeUnder` takes the shape from the first line under the heading that is *data rather than
words*; the heading's own words still guess the roles where there are as many of them as there are
columns, and where there are not, the mapper shows the first row's cells to assign from instead.
**One column may be blank**, so a cash line printed inside the table no longer ends it.

**The total is looked for, not only pointed at** (D-203). A model asked for `totalValueLine`
returned nothing on the first real statement, so the app reported a portfolio nothing could be
checked against while `סה"כ  76,000.00  100.00` sat two lines under the rows it had just walked.
`readHoldingRows` now reads a **bare** total label under its last row through the table's own value
column — a total line is a row of its own table and its last figure is a percentage (D-194) — and
`סה"כ ניירות ערך` is refused, because the securities' total is not the account's on a statement with
cash. A line somebody pointed at always wins.

**The date is not optional.** Without it no price is recorded — a price with no date is not a price
— and a position is opened with nothing to confirm it as of. The mapper asks for it and says why.

**What a holdings table gives and does not give.** It gives units, a price and a value per row, and
a total. It does not give what you paid — so a portfolio read off a statement has **no cost basis
and therefore no gain**, and the screen says that rather than showing the whole value as a profit.

**And there is a second way in, which is not this ladder** (D-207, M16 U12). The plugin's
`record_positions` and `record_trades` take the rows a *conversation* read off the page, one entry
each, whatever the file was — which is the answer for a statement no rung can manage and for one
this app has never seen a format of. **It is not a shortcut past the checks.** The tools take the
statement's own value column and printed total beside the units and the price, run
`holdingReconciles` and `pricePossible` over the figures they are about to store, and put both
verdicts in the dry run a person has to approve. A model reading a page is a proposer exactly like
the derived format is, and it is checked exactly like one. **Opening the file stays app-side**: a
holdings table is a confirm surface somebody points at.

## A price, and where it came from

Transcribed off the statement, typed by hand, or fetched — `electron/prices.ts`, main process, one
allowlisted host, off by default, on an explicit refresh (D-178). All three are stored the same way
with a source and an as-of date, and **every figure must be correct from the last price the document
holds**. Turning the fetch off changes no number, only how fresh it is.

**What leaves the machine when it is on**: the list of securities you asked about, plus an IP. Not a
statement, a balance, a merchant or a salary — but a portrait of a portfolio, and the README and the
enabling prompt both say so.

**A security with no quote says so** rather than showing a stale number as a fresh one. The
provider is **Stooq** (D-187) — one host, no key, CSV — and it takes symbols rather than ISINs, so
`providerMapping` maps a security to one **conservatively**: a suffixed ticker as given, a US listing
in USD as `<ticker>.us`, and everything else unmapped and not asked about. Today that means **no Tel
Aviv security is mapped at all**, which is D-178's stated risk arriving slightly worse than stated.
A symbol guessed onto the wrong exchange returns a real price for a different instrument, which is
why the mapping refuses rather than guesses — and why transcription is the floor and the fetch is
the convenience on top of it.

**And the refusal says why** (D-202). It is the common case, not the edge one, so a screen with
nothing to say about it reads as a feature that does not work: *"0 prices, and 5 the provider does
not cover"* is what a broken fetch says too. `providerMapping` (which replaced
`providerSymbol`) returns `NO_SYMBOL`, `NOT_A_US_LISTING` or `CURRENCY_DISAGREES` — **the same
function the refresh itself calls**, so a screen cannot promise a quote the fetch would decline — and three surfaces print it: the refresh
result names every security it did not price, the portfolio's gap list carries a clause per unpriced
position, and the holding detail says it per security, either as *a refresh asks about this one as
`vti.us`* or as *a refresh will never price this one*. All three end at the same sentence, which is
this section's own: a price off the statement or typed by hand is what these are worth and always
was. **Only where the fetch exists** — in the browser build it is true of everything and says
nothing.

**What is asked about did not widen.** `securitiesToQuote` returns every held security now rather
than every held security with a ticker, because the ticker filter made a Tel Aviv holding invisible
to the *answer* without making the *request* any smaller: an unmapped security was never asked about
either way. D-178's sentence is unchanged.

## Currency is the trap

Two traps, and they are different.

- **A USD position in an ILS document** is `Money` in two currencies plus a rate belonging to a
  date. D-184: the rate is a stored record, `convert` is the only crossing, and a position the
  table cannot reach is reported in its own currency and named.
- **TASE prices are printed in agorot** while the security is denominated in shekels.
  `security.currency` is what the *price* is quoted in and the stored price is always in whole units
  of it, so a quote of 12,345 agorot is stored as ₪123.45. The ÷100 belongs to the edge that read
  the quote and never to a total — and **the statement reader is one of those edges**, which it was
  not until a real document arrived storing ₪2,459.00 units at ₪245,900.00 (D-194). It decides by
  the statement's own `units × price = value` rather than by the exchange, because the exchange is
  free text off a document and the arithmetic is a fact. **The division is exact** (D-204): a price
  is a `UnitPrice` and not `Money` — millionths of a minor unit — so 157.35 agorot is ₪1.5735 and
  multiplying it back out agrees with the value column. It stored as ₪1.57 until M16 U9.
  **The review of 2026-09-04 found the deciding silent when it cannot decide** (D-203): the equation
  needs a *value* column, and a real statement whose value column was read as the cost column gives
  it nothing to count — the verdict falls to `unknown` and the prices stay in agorot. **A vote is
  not a check, and M16 U8 is the check.** `holdingReconciles` asks `units × price = value` of each
  row; `pricePossible` asks whether the row could be worth that inside this account at all, which
  needs no value column and decides `21 × 245,900.00 = 5,163,900` against a portfolio of ₪72,000.00
  on its own. Both skip a zero factor, because an Israeli cash line prints inside the table with no
  units and no price. And `unknown` is now said out loud, in the direction that matters: the prices
  are as printed, and on a Tel Aviv statement every one of them is then a hundred times too big.

## What you plan to buy

A `PurchasePlan` per security: an amount and a cadence. `plannedPurchases` restates every active
plan as a monthly figure, so the projection can compound it and the splitter can be checked against
it.

**The splitter connects through a saving goal, not through a new target kind.** `TARGET_KINDS` ships
complete in migration `014` and a `CHECK` cannot be altered without rebuilding the table, so an
investment bucket is a `SAVING_GOAL` bucket whose goal's default holding is the brokerage's cash
holding: applying the plan deposits into the cash, and the purchase plan says what that cash is for.
Plan-vs-actual already exists to say whether you did it.

**The assumed return is not on the plan.** It is `Holding.expectedReturn` with basis `ASSUMED`,
because a rate belongs to the thing that earns it (D-175) and a plan carrying one too would give a
position two rates that can disagree.

`investmentFunding` is the check: what the split sends to a goal whose default holding sits where a
position is held, against what the plans need. **Three verdicts** — `COVERED`, `SHORT` and
`UNALLOCATED`, the last because a portfolio fed by hand is a real way to run one and calling it
short by everything would be an accusation. The splitter computes it from its **live** allocations
so the line moves with the bar; the Investments side reads the saved default plan.

The projection on *What to buy* compounds each position at its own assumed rate with the plan as the
monthly contribution — an illustration that names its assumptions, and a position with no rate is
projected flat and counted in a sentence rather than given a guess.

**A plan may name a security you do not hold yet** (D-201). `holdingId` has been nullable since
migration `025` and nothing used it until the onboarding step did: an intention about something you
have not bought is the commonest intention there is, and the purchase-plan tab used to disable its
own button and say *add a position first*. `resolvePlanSecurity` makes the security on a typed name,
`OTHER` and with no key, and matches an existing one **by name** — the only key such a security has,
and the one place in this app where a name is allowed to be a key at all (D-195 is the contrast).

**The app records an intention and never offers one.** Nothing here ranks a security, suggests one,
or has an opinion about one, and no future unit adds a surface that does.

## What paid for it

A trade names the transaction that funded it — one nullable `fundingTransactionId`, and the
reconciliation between the bank's statement and the broker's (D-200). Both documents were already in
the file with nothing joining them: the broker prints what was bought, the bank prints the money
that went to the broker.

**The difference is the answer, not an error.** A ₪11,000 transfer against ₪11,000.00 of buys is the
real shape, and the ₪81.95 came from cash already at the broker; money sent ahead of a purchase sits
as cash until it is spent. `tradeFunding` says which of the three it is and the screen says it in
words. Nothing is coloured as a fault, because neither direction is one.

**Nothing is auto-linked.** `fundingCandidates` ranks the money that left an account within a
fortnight either side of the purchase — exact amount first, then whatever could have covered the
whole purchase, then closeness in days — and the link is written only when somebody picks a row. An
exact amount is a hint at the top of a list rather than a match: a real week is the case
where no single transfer equals any single purchase.

`investmentFunding` above is the other question and they share no arithmetic: that one asks whether
the *plan* is covered by the split, and this one asks where the money that already moved came from.

## Screens

`/wealth/investments`, a child of Wealth with two tabs — the portfolio and what you plan to buy.
Per account and across all of them: composition, what each position is worth, and what the account's
cash and its positions add up to against the statement's own total.

**What paid for it** is the third tab, at `/wealth/investments/funding` — a view across positions
rather than of one, because a single transfer buys three securities and a panel on any one position
could never make the difference add up.

**Onboarding has a step of its own** (D-201), between the documents step and the checklist: do you
hold anything, and do you know what you want. It is a hub over the components these screens use —
`StatementIntake`, `PositionEditor`, `PlanForm` — and its checklist item is the only conditional one
in F12, listed for a document with a brokerage in it and left off every other.

**A position has a screen of its own** at `/wealth/investments/:holdingId`, reached by the row's name
(D-197). It is where every verb that acts on one position lives, and what it adds over the row is the
**working**: the cost basis as the walk that produced it, one trade at a time, with the summary above
being that walk's last row rather than a second computation of it. Removing a trade or a price is
here too, and it is the only way to undo a statement read wrongly.

**Colour follows D-125 without an amendment.** No figure wears the accent; a gain is `positive` and
a loss is `negative`, because both are things the app *found* rather than things you can act on.

## Acceptance

- An investment account's composition comes off the statement the user already has.
- What it is worth is a figure with a date and a source on it.
- A plan to buy monthly appears in the projection and in the splitter.
- **Turning the price fetch off changes no number, only how fresh it is.**
- No division by zero anywhere in `domain/investments.ts`; every quotient is guarded by a variant.

## Open questions

- ~~No real investment statement has been read.~~ **Six were, on 2026-09-03, and the reader read
  nothing off any of them** (D-194) — the tabular half, exactly where this said it would break. What
  the prediction got wrong is that `TableMapper` was no use either: the fallback rung had the same
  assumption baked into it, so there was no floor under the failure. **A manual rung that shares the
  automatic rung's model of the document is not a fallback**, and that is the finding worth carrying
  to the next reader this project builds.
- ~~The trades table is read by nothing.~~ **It is read now** (D-196, M16 U2). `tradesTable.ts` is
  a second table on the same statement, with its own heading anchor, its own column roles and its
  own price-scale vote — and the split rows are rejoined by what the document says rather than by
  retuning `PANEL_GAP`: **a line whose first cell is a date starts a row, and a line that follows it
  and does not is the rest of it.** What is *not* read is the tax column, deliberately: the amount
  column is what moved with the tax already inside it, and a second record of one fact is D-036.
  Two things are still open under it — a movement in a security nothing at the place holds is
  declined rather than opening a position at zero units, and the vocabulary of kind words is closed
  (`קניה`, `ק/`, `מכירה`, `מכ/`, and the English), so a word nobody has taught it is not a trade.
- **A statement is read one at a time.** Fund reports gained a batch on D-164 after somebody sat
  down with eight of them; nobody has yet sat down with eight statements, and the queue is not built
  until they have.
- **Which price provider** is a build-time question and is deliberately unanswered (D-178). The
  adapter interface exists; a TASE source may not.
- ~~No edge links a bank transaction to a trade.~~ **One does now** (D-200, M16 U5), and two
  things are open under it. **Partial funding is deliberately unmodelled**: a trade names one
  transaction, and a purchase genuinely split across two transfers can only name the larger. And the
  **sale half is not asked about** — money arriving from a sale is a deposit into the cash holding,
  which is a different edge and one no statement here has needed, the six real ones being all buys.
- **Dividends** are not modelled. A dividend arriving as cash is an ordinary deposit into the cash
  holding today, which is true but does not attribute it to the security that paid it. Waits for a
  real statement that prints one.

## Related

[04 Data Model](./04-data-model.md) · [F07 Savings and Deposits](./f07-savings-and-deposits.md) ·
[F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md) ·
[F17 Mapping Templates](../../mapping-templates.md) ·
[09 Decision Log](../../09-decision-log.md)
