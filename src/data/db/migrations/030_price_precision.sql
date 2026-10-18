-- 030_price_precision — a price finer than an agora. See docs/04-data-model.md,
-- docs/f18-investments.md and D-204.
--
-- Numbered and immutable after release (D-020).
--
-- **Two tables rebuilt, and no figure moved.** `price_minor` and
-- `unit_price_minor` become `price_micro` and `unit_price_micro` — millionths of
-- a minor unit, which is the same integer with six more digits — so the copy
-- multiplies by a million and every existing price means exactly what it meant.
-- The rebuild is 026's and 027's four steps (create, copy, drop, rename) for a
-- different reason: SQLite can add a column in place and this replaces one, and
-- a table carrying both would be two records of one fact (D-036).
--
-- **What it is for.** Tel Aviv quotes a shekel-denominated security in agorot,
-- so the ÷100 at the reading edge turned `250.50` into ₪2.5050 — and
-- `unit_price_minor` could only hold ₪2.51. Nothing was *wrong*: every total in
-- F18 is built from the statement's own value column, so the rounded price sat
-- in the one figure nothing multiplied back out. M16 U8 changed that by
-- multiplying it back out (`holdingReconciles`), and U10 changes it again by
-- putting the price in front of the person as an editable field. A field reading
-- ₪2.51 where the statement says `250.50` is a wrong number they are being asked to
-- confirm.
--
-- **Why millionths of a *minor* unit and not of a major one.** `quantity_micro`
-- and `rate_micro` are both millionths of a whole unit, and the consistent
-- choice here would have been millionths of a shekel. It is not the one made,
-- for the sake of this file: minor units per major unit are two for ILS, three
-- for KWD and none for JPY, so a backfill in major units needs the app's
-- currency table copied into a migration that can never be corrected. Times a
-- million is right for every currency and cannot go stale. The price a person
-- reads is unaffected either way — `formatPrice` prints the digits the price
-- has, in the currency's own units.
--
-- **Six digits, and the range that buys.** A safe integer holds ₪90,000,000,000
-- of minor units at this scale, which is nine orders past the most expensive
-- security anyone holds, and the product in `valueOf` is taken in `BigInt`
-- anyway. Four digits would cover the TASE money-market case that prompted this
-- and nothing else; six is `Quantity`'s answer to the same question and the two
-- factors now match.
--
-- **What this migration cannot do is recover the digits that were never
-- there.** A price stored as ₪1.57 by an earlier release stays ₪1.57 here; only
-- the next reading of that statement carries ₪1.5735. `upsertTrade` therefore
-- matches a price **to the agora** rather than to the millionth — a natural key
-- that demanded the new digits would insert a second copy of every trade in
-- every migrated document the next time its statement was read, which is the one
-- thing that function exists to prevent (docs/conventions.md, "every import is
-- idempotent").

-- 1 -------------------------------------------------------------------------
-- security_price. Every column, default, index and unique predicate is 025's,
-- carried across as written.

CREATE TABLE security_price_new (
  id            TEXT PRIMARY KEY NOT NULL,
  security_id   TEXT NOT NULL REFERENCES security (id),
  as_of         TEXT NOT NULL,
  currency      TEXT NOT NULL,
  -- Per **one** unit, in **millionths of a minor unit** of `currency`: ₪2.5050
  -- is 250500000. Not per lot, not per hundred — every quantity in this schema
  -- is in units and this is what one of them costs, so the multiplication has
  -- no convention in it. The agorot a Tel Aviv statement prints are divided by
  -- a hundred at the edge that read them (D-184), and at this width that
  -- division is exact.
  price_micro   INTEGER NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('TRANSCRIBED', 'TYPED', 'FETCHED')),
  source_detail TEXT,
  created_at    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER
);

INSERT INTO security_price_new (id, security_id, as_of, currency, price_micro, source,
                                source_detail, created_at, updated_at, deleted_at)
     SELECT id, security_id, as_of, currency, price_minor * 1000000, source,
            source_detail, created_at, updated_at, deleted_at
       FROM security_price;

DROP TABLE security_price;
ALTER TABLE security_price_new RENAME TO security_price;

CREATE UNIQUE INDEX security_price_point
  ON security_price (security_id, as_of, source)
  WHERE deleted_at IS NULL;

CREATE INDEX security_price_latest ON security_price (security_id, as_of DESC);

-- 2 -------------------------------------------------------------------------
-- security_trade, with 029's funding column carried across.

CREATE TABLE security_trade_new (
  id                     TEXT PRIMARY KEY NOT NULL,
  holding_id             TEXT NOT NULL REFERENCES holding (id),
  security_id            TEXT NOT NULL REFERENCES security (id),
  date                   TEXT NOT NULL,
  side                   TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity_micro         INTEGER NOT NULL,
  currency               TEXT NOT NULL,
  -- What one unit executed at, in millionths of a minor unit. `price_micro`'s
  -- unit exactly; a trade and a valuation are the same arithmetic.
  unit_price_micro       INTEGER NOT NULL,
  -- The fee and the consideration are **amounts** and stay `Money`. Money that
  -- moved is money that moved: a broker charges whole agorot, and widening a
  -- figure a statement printed exactly would invite the app to disagree with it.
  fee_minor              INTEGER NOT NULL DEFAULT 0,
  consideration_minor    INTEGER,
  funding_transaction_id TEXT REFERENCES "transaction" (id),
  note                   TEXT,
  created_at             INTEGER NOT NULL DEFAULT 0,
  updated_at             INTEGER NOT NULL DEFAULT 0,
  deleted_at             INTEGER
);

INSERT INTO security_trade_new (id, holding_id, security_id, date, side, quantity_micro,
                                currency, unit_price_micro, fee_minor, consideration_minor,
                                funding_transaction_id, note, created_at, updated_at, deleted_at)
     SELECT id, holding_id, security_id, date, side, quantity_micro,
            currency, unit_price_minor * 1000000, fee_minor, consideration_minor,
            funding_transaction_id, note, created_at, updated_at, deleted_at
       FROM security_trade;

DROP TABLE security_trade;
ALTER TABLE security_trade_new RENAME TO security_trade;

CREATE INDEX security_trade_holding ON security_trade (holding_id, date);
CREATE INDEX security_trade_security ON security_trade (security_id, date);
CREATE INDEX security_trade_funding ON security_trade (funding_transaction_id);
