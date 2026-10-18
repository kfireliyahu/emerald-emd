-- 025_investments — securities, positions, trades, prices and what you plan to
-- buy. See docs/f18-investments.md, docs/04-data-model.md ("Investments") and
-- D-178, D-181 to D-184.
--
-- Numbered and immutable after release (D-020).
--
-- **A position is a holding** (D-181), which is the whole reason this migration
-- adds six tables and not seven. M15 built the record that says what form money
-- takes; a position in an index fund is a form money takes. So `holding` with
-- `kind = 'SECURITY'` *is* the position, and `security_position` below is a 1:1
-- extension of it carrying the two facts a holding cannot hold: which security,
-- and how many units.
--
-- What that buys, and it is not a small list: `is_liquid` already means the
-- right thing per position, `expected_return_bp` with basis `ASSUMED` is
-- exactly the roadmap's "what you assume it earns", `fee_bp` is an ETF's
-- expense ratio, and `provenance = 'VALUED'` with `last_confirmed_at` is
-- already the sentence the money map says about a stale figure. The projection
-- (D-175) already compounds per holding at its own rate, net worth already
-- reads holdings, and the money map already lists them under their place.
-- Every one of those works on a position on the day this migration lands,
-- without a line of new code in any of them.
--
-- **Nothing here changes a figure.** Every table is new and nothing existing is
-- rebuilt or repointed: a document that has no securities in it reads exactly
-- as it did at 24. That is a weaker acceptance test than 024's and it is the
-- right one — 024 moved columns between existing tables and had to prove it
-- moved no money; this one adds records that did not exist.

-- 1 -------------------------------------------------------------------------
-- The instrument, keyed on ISIN.
--
-- **A security is a label, not an amount.** It carries nothing that changes
-- with the market — no price, no quantity, no value — which is what lets two
-- accounts hold the same ETF and share one record of what it is.

CREATE TABLE security (
  id           TEXT PRIMARY KEY NOT NULL,
  -- The real key when it is known, and it usually is: an Israeli broker's
  -- statement prints it and so does every European one. Nullable because a
  -- user typing "the S&P fund" from memory should not be blocked on twelve
  -- characters they do not have.
  isin         TEXT,
  -- The short name a person actually says. Not unique and not a key: VOO is
  -- one thing on one exchange and something else on another, which is exactly
  -- why ISIN exists.
  ticker       TEXT,
  name         TEXT NOT NULL,
  -- **The currency the price is quoted in**, which is not necessarily the
  -- document's. A USD holding inside an ILS document is the trap this column
  -- and `fx_rate` below exist to keep honest: the value is `Money` in two
  -- currencies plus a rate belonging to a date, never a silent conversion.
  --
  -- The TASE trap, stated here because it has cost every app that has met it:
  -- a Tel Aviv price is printed in **agorot** while the security is denominated
  -- in shekels. The price stored here is always in whole units of `currency`,
  -- so a quote of 12,345 agorot is stored as 123.45 ILS. The conversion belongs
  -- at the edge that read it — the transcription form or the fetch adapter —
  -- and never in a total.
  currency     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'EQUITY', 'ETF', 'MUTUAL_FUND', 'BOND', 'CRYPTO', 'OTHER')),
  -- Free text, like `holding_place.institution` and for 018's reason: this is a
  -- label a statement printed, not a record the app has.
  exchange     TEXT,
  note         TEXT,
  is_archived  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
);

-- One row per ISIN, so reading a second statement finds the security the first
-- one created rather than making a twin. Partial, because NULL is not a key and
-- SQLite would happily hold several of them.
CREATE UNIQUE INDEX security_isin ON security (isin)
  WHERE isin IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX security_name ON security (name);

-- 2 -------------------------------------------------------------------------
-- The position: which security a `SECURITY` holding holds, and how many units.
--
-- Keyed on the holding rather than on an id of its own, which is the 1:1 said
-- in the schema instead of in a comment. A holding has at most one of these; a
-- holding with none is an ordinary holding and every existing figure treats it
-- as one.

CREATE TABLE security_position (
  holding_id     TEXT PRIMARY KEY NOT NULL REFERENCES holding (id),
  security_id    TEXT NOT NULL REFERENCES security (id),
  -- **Units in millionths** (D-182). A share count is not money and does not go
  -- through `Money`, but it has D-003's problem in full: 0.1 + 0.2 shares of a
  -- fractional-share broker is 0.30000000000000004, and that error reaches a
  -- value the moment it is multiplied by a price. So the same answer — an
  -- integer of a small enough unit, converted at the edges and never within a
  -- calculation. Six digits holds every real fractional-share quantity; the
  -- brokers that offer them quote four or five.
  quantity_micro INTEGER NOT NULL,
  -- When the quantity was last read off something, date-only. This is not the
  -- price's date and the two really do differ: a statement dated March tells
  -- you how many units you had in March, and a price fetched today tells you
  -- what one is worth today. NULL means it has never been confirmed.
  quantity_as_of TEXT,
  created_at     INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL DEFAULT 0,
  deleted_at     INTEGER
);

-- "Everywhere I hold this" — the across-accounts half of the Investments screen,
-- and what a price refresh iterates.
CREATE INDEX security_position_security ON security_position (security_id);

-- 3 -------------------------------------------------------------------------
-- What one unit is worth, when that was true, and where the number came from.
--
-- **A price is never load-bearing** (D-178). All three sources are stored
-- identically and every figure must be right from whichever is latest — the
-- fetch is a convenience on top of transcription, not the floor under it.

CREATE TABLE security_price (
  id            TEXT PRIMARY KEY NOT NULL,
  security_id   TEXT NOT NULL REFERENCES security (id),
  -- Date-only, YYYY-MM-DD (D-023). A price belongs to a day; an intraday
  -- timestamp would be a precision this app has no use for and no way to keep.
  as_of         TEXT NOT NULL,
  currency      TEXT NOT NULL,
  -- Per **one** unit, in minor units of `currency`. Not per lot, not per
  -- hundred: every quantity in this schema is in units and this is what one of
  -- them costs, so the multiplication has no convention in it.
  price_minor   INTEGER NOT NULL,
  -- `TRANSCRIBED` came off a statement (D-159's answer, and the one that works
  -- for every security including the ones no free provider covers); `TYPED` the
  -- user entered; `FETCHED` came over the network from the main process, on an
  -- explicit refresh and never by default (D-178).
  source        TEXT NOT NULL CHECK (source IN ('TRANSCRIBED', 'TYPED', 'FETCHED')),
  -- Which statement, or which provider. What the screen says under the figure.
  source_detail TEXT,
  created_at    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER
);

-- One price per security per day per source. Refreshing twice in an afternoon
-- replaces rather than appends, and a statement transcribed on the same day a
-- price was fetched keeps both — because they are two claims about one day and
-- the user is entitled to see that they disagree.
CREATE UNIQUE INDEX security_price_point
  ON security_price (security_id, as_of, source)
  WHERE deleted_at IS NULL;

CREATE INDEX security_price_latest ON security_price (security_id, as_of DESC);

-- 4 -------------------------------------------------------------------------
-- The purchase history, when the user has it.
--
-- Optional in the strongest sense: a position with no trades still has a
-- quantity, a price and a value. What trades add is **cost basis**, and with it
-- the only two figures in this milestone that cannot be derived from a
-- statement's holdings table — what you paid, and what you have made.

CREATE TABLE security_trade (
  id                  TEXT PRIMARY KEY NOT NULL,
  holding_id          TEXT NOT NULL REFERENCES holding (id),
  -- Denormalised from the position on purpose. A trade outlives the position it
  -- was made in — sell everything and the holding may be archived — and a
  -- realised gain that lost its security when a position closed would be a
  -- history that erases itself at the moment it becomes interesting.
  security_id         TEXT NOT NULL REFERENCES security (id),
  date                TEXT NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  -- Always positive; `side` carries the sign. A negative quantity and a SELL
  -- are two records of one fact that can disagree (D-036's rule, again).
  quantity_micro      INTEGER NOT NULL,
  currency            TEXT NOT NULL,
  unit_price_minor    INTEGER NOT NULL,
  -- What the broker charged, in the same currency. Zero is a real answer and is
  -- the default; NULL would be "unknown", which no statement has ever been.
  fee_minor           INTEGER NOT NULL DEFAULT 0,
  -- **What actually moved**, as printed on the confirmation. NULL means derive
  -- it — quantity times price, plus the fee on a buy and minus it on a sell.
  -- Stored when it is printed because a broker's rounding is a fact about the
  -- money that left the account, and an app that recomputes it is an app that
  -- disagrees with the statement by an agora and cannot say why.
  consideration_minor INTEGER,
  note                TEXT,
  created_at          INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL DEFAULT 0,
  deleted_at          INTEGER
);

CREATE INDEX security_trade_holding ON security_trade (holding_id, date);
CREATE INDEX security_trade_security ON security_trade (security_id, date);

-- 5 -------------------------------------------------------------------------
-- What you plan to buy.
--
-- **An intention, not a transaction** — the forward-looking half, like
-- `split_bucket` and unlike everything else in this migration. It feeds the
-- projection as a monthly contribution and it is what the splitter's investment
-- bucket is a plan *for*; it never writes a trade and it never moves a figure
-- on its own.

CREATE TABLE purchase_plan (
  id           TEXT PRIMARY KEY NOT NULL,
  security_id  TEXT NOT NULL REFERENCES security (id),
  -- Where the units would land. Nullable, because "1,000 a month into the S&P"
  -- is a decision a person makes before they have opened the account.
  holding_id   TEXT REFERENCES holding (id),
  currency     TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  cadence      TEXT NOT NULL CHECK (cadence IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
  start_date   TEXT,
  end_date     TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  note         TEXT,
  created_at   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER
);

CREATE INDEX purchase_plan_active ON purchase_plan (is_active, security_id);

-- 6 -------------------------------------------------------------------------
-- A rate belonging to a date.
--
-- The document has one currency and a portfolio need not. D-003 says there is
-- no rate in this document and a foreign amount is *listed rather than
-- converted*, which is the right answer for a card transaction — a foreign
-- charge already arrived in shekels and the original is a note about it. A USD
-- position is the other case: nothing has converted it, and refusing to is
-- refusing to say what the portfolio is worth.
--
-- So a rate, stored the way a price is: explicit, dated, its own record, and
-- **never invented**. A position whose currency this table cannot reach is
-- reported in its own currency and left out of the document-currency total by
-- name, which is `partitionByCurrency`'s treatment of a foreign deposit and not
-- a new rule.

CREATE TABLE fx_rate (
  id             TEXT PRIMARY KEY NOT NULL,
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  as_of          TEXT NOT NULL,
  -- One unit of base in **millionths** of a unit of quote: USD to ILS at 3.72
  -- is 3_720_000. Millionths for the same reason quantities are (D-182), and it
  -- is generous — six digits on a rate near 1 is more precision than any
  -- published rate carries.
  rate_micro     INTEGER NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('TRANSCRIBED', 'TYPED', 'FETCHED')),
  source_detail  TEXT,
  created_at     INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL DEFAULT 0,
  deleted_at     INTEGER
);

CREATE UNIQUE INDEX fx_rate_point
  ON fx_rate (base_currency, quote_currency, as_of, source)
  WHERE deleted_at IS NULL;

CREATE INDEX fx_rate_latest ON fx_rate (base_currency, quote_currency, as_of DESC);
