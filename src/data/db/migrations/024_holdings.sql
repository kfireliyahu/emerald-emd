-- 024_holdings — the record that says what form the money is in, and the three
-- rebuilds that move the instrument's properties onto it. See
-- docs/f07-savings-and-deposits.md, docs/04-data-model.md ("Savings") and
-- D-175, D-176.
--
-- Numbered and immutable after release (D-020).
--
-- **This migration must not change a single figure.** Every per-place total,
-- both liquidity subtotals and every goal balance read the same after it as
-- before, and that is its whole acceptance test (D-175) — a migration that
-- improves a savings number is a bug however defensible the new number is. It
-- moves three columns from one table to another and rewrites two foreign keys;
-- it computes nothing.
--
-- **What was wrong.** D-074 put `expected_return_bp` on `holding_place` because
-- the place was the only record there was to put it on. A bank does not have a
-- return: the fixed deposit you hold there does, the current account beside it
-- does not, and both are at the same place. The same is true of `is_liquid` —
-- a brokerage account's cash is reachable this week and its index fund is not,
-- and today a whole place has to be one or the other.
--
-- So a **`holding`** takes them: what form the money is in, which is the thing
-- that actually earns a return and the thing that actually is or is not
-- reachable. A place goes back to being a location. **Money always lands in a
-- holding** — cash is an ordinary holding, which is also what lets M16 put a
-- position and the cash beside it in one place without nesting.
--
-- Four steps, and the rebuilds are the standard four each: create, copy, drop,
-- rename. Nothing here is referenced by another table's foreign key that is not
-- rewritten below, and this app never sets `PRAGMA foreign_keys = ON` (D-067),
-- so no rename can orphan anything.

-- 1 -------------------------------------------------------------------------
-- The new record.

CREATE TABLE holding (
  id                TEXT PRIMARY KEY NOT NULL,
  holding_place_id  TEXT NOT NULL REFERENCES holding_place (id),
  -- A place can hold several, so each says which one it is. The migration names
  -- the backfilled one after its kind ("Cash", "Fixed deposit"), because a place
  -- called "Bank Hapoalim" holding one holding also called "Bank Hapoalim"
  -- reads as a bug rather than as a hierarchy.
  name              TEXT NOT NULL,
  -- **What form the money takes.** `TRACK` is a pension or provident investment
  -- track; `SECURITY` is a position in one security and is what M16 fills in.
  kind              TEXT NOT NULL CHECK (kind IN (
                      'CASH', 'DEPOSIT', 'FUND', 'TRACK', 'SECURITY', 'OTHER')),
  -- **How the balance is known** (D-176), declared rather than inferred.
  -- `RECORDED` is Σ the movements the user entered and nothing else will ever
  -- confirm it; `TRANSCRIBED` means a statement says what it is; `VALUED` means
  -- positions times a price (M16). Inferring this from whether snapshots exist
  -- would make a holding change its own kind by being neglected, and the whole
  -- point of the column is to let the app say "you have not confirmed this
  -- since March" about a holding that has never been confirmed at all.
  provenance        TEXT NOT NULL CHECK (provenance IN (
                      'RECORDED', 'TRANSCRIBED', 'VALUED')),
  -- Date-only, `YYYY-MM-DD`, never an epoch (D-023). NULL means never.
  last_confirmed_at TEXT,
  -- Moved from `holding_place`. Still the user's answer and not an inference
  -- from `kind` — a פק"מ maturing next week and one with six months to run are
  -- the same kind and different answers — but now it is answerable per
  -- instrument, which is what makes the emergency-fund figure more honest
  -- rather than merely differently arranged.
  is_liquid         INTEGER NOT NULL DEFAULT 1,
  -- Moved from `holding_place`, unchanged in every respect except which table
  -- it sits in. Integer basis points (D-003); the two columns stay one nullable
  -- `ExpectedReturn` in the domain, so a rate can never be held without its
  -- provenance (D-074).
  expected_return_bp INTEGER,
  expected_return_basis TEXT CHECK (
                      expected_return_basis IN ('CONTRACTUAL', 'ASSUMED')),
  -- When a term ends, for the holdings that have one. Date-only. A locked
  -- deposit that matures in March is a different sentence from one that never
  -- matures, and it is the fact `is_liquid` is a judgement about.
  term_end_date     TEXT,
  -- What the holding charges a year, in basis points. `fund_account` has its
  -- own two fee bases and keeps them (D-177); this is the single management fee
  -- an ordinary instrument prints.
  fee_bp            INTEGER,
  note              TEXT,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- The money map reads holdings by place, and the liquidity split reads them by
-- reachability. Two indexes because those are two orders, and the first one is
-- also how a place's editor lists what is in it.
CREATE INDEX holding_place_of ON holding (holding_place_id, name);
CREATE INDEX holding_liquidity ON holding (is_liquid, name);

-- **One holding per existing place, carrying exactly what the place carried.**
-- This is the row that keeps every figure still: whatever a place's liquidity
-- and rate were, its single holding now has them, so a per-place total, a
-- liquidity subtotal and a projection all read the same as before.
--
-- The id is derived from the place's rather than generated, because a migration
-- that runs in the app, in the plugin and in a test must produce the same
-- document from the same input — and because `saving_deposit` and `saving_goal`
-- below have to point at it without a second pass.
--
-- Provenance is `RECORDED` for all of them and that is not a default standing
-- in for a real answer: it is what is true today. Every balance in this schema
-- before this migration is Σ the deposits the user entered, with nothing in the
-- document that could confirm it. `last_confirmed_at` is NULL for the same
-- reason — nobody has confirmed anything yet, and writing today's date here
-- would be the app inventing a fact about the user's records.
INSERT INTO holding (
  id, holding_place_id, name, kind, provenance, last_confirmed_at, is_liquid,
  expected_return_bp, expected_return_basis, term_end_date, fee_bp, note,
  is_archived, created_at, updated_at, deleted_at
)
SELECT
  'h-' || id,
  id,
  CASE kind
    WHEN 'CHECKING'    THEN 'Cash'
    WHEN 'CASH'        THEN 'Cash'
    WHEN 'DEPOSIT'     THEN 'Fixed deposit'
    WHEN 'INVESTMENT'  THEN 'Fund'
    WHEN 'PROVIDENT'   THEN 'Track'
    WHEN 'STUDY_FUND'  THEN 'Track'
    ELSE 'Holding'
  END,
  CASE kind
    WHEN 'CHECKING'    THEN 'CASH'
    WHEN 'CASH'        THEN 'CASH'
    WHEN 'DEPOSIT'     THEN 'DEPOSIT'
    WHEN 'INVESTMENT'  THEN 'FUND'
    WHEN 'PROVIDENT'   THEN 'TRACK'
    WHEN 'STUDY_FUND'  THEN 'TRACK'
    ELSE 'OTHER'
  END,
  'RECORDED',
  NULL,
  is_liquid,
  expected_return_bp,
  expected_return_basis,
  NULL,
  NULL,
  NULL,
  is_archived,
  created_at,
  updated_at,
  deleted_at
FROM holding_place;

-- 2 -------------------------------------------------------------------------
-- `holding_place` becomes a location and nothing else.

CREATE TABLE holding_place_new (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'CHECKING', 'DEPOSIT', 'INVESTMENT', 'PROVIDENT',
                      'STUDY_FUND', 'CASH', 'OTHER')),
  -- Unchanged, and deliberately still not `institution_id` (018's reason).
  institution       TEXT,
  note              TEXT,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

INSERT INTO holding_place_new (
  id, name, kind, institution, note, is_archived, created_at, updated_at, deleted_at
)
SELECT id, name, kind, institution, note, is_archived, created_at, updated_at, deleted_at
FROM holding_place;

DROP TABLE holding_place;

ALTER TABLE holding_place_new RENAME TO holding_place;

-- 018's index was `(is_liquid, name)` because the "where is my money" view was
-- two sections and the sections were that column. Liquidity is a holding's
-- property now, so the index that answers it moved up with it
-- (`holding_liquidity`), and what is left here is the place's own order.
CREATE INDEX holding_place_name ON holding_place (name);

-- 3 -------------------------------------------------------------------------
-- A deposit lands in a holding.

CREATE TABLE saving_deposit_new (
  id                TEXT PRIMARY KEY NOT NULL,
  goal_id           TEXT NOT NULL REFERENCES saving_goal (id),
  date              TEXT NOT NULL,
  currency          TEXT NOT NULL,
  -- Negative for a withdrawal or a loss. Never zero. Unchanged.
  amount_minor      INTEGER NOT NULL,
  -- **The column this migration exists for.** Everything else about the table
  -- is carried across exactly as 019 left it: same columns, same order, same
  -- defaults, same CHECK, same indexes, same partial-unique predicate.
  holding_id        TEXT NOT NULL REFERENCES holding (id),
  source_kind       TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source_kind IN (
                      'MANUAL', 'FROM_TRANSACTION', 'FROM_PAYCHECK_DEDUCTION',
                      'FROM_PLAN', 'OPENING_BALANCE', 'GROWTH')),
  source_ref_id     TEXT,
  transfer_group_key TEXT,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- `'h-' || holding_place_id` rather than a join, and the difference matters: a
-- deposit naming a place this document does not have keeps pointing at nothing,
-- which is exactly what it did before. A join would drop the row, and a dropped
-- deposit is a moved figure — the one thing this migration may not do. The
-- domain already has a variant for an unknown holding and counts it as locked.
INSERT INTO saving_deposit_new (
  id, goal_id, date, currency, amount_minor, holding_id, source_kind,
  source_ref_id, transfer_group_key, note, created_at, updated_at, deleted_at
)
SELECT
  id, goal_id, date, currency, amount_minor, 'h-' || holding_place_id, source_kind,
  source_ref_id, transfer_group_key, note, created_at, updated_at, deleted_at
FROM saving_deposit;

DROP TABLE saving_deposit;

ALTER TABLE saving_deposit_new RENAME TO saving_deposit;

CREATE INDEX saving_deposit_goal_date ON saving_deposit (goal_id, date);
CREATE INDEX saving_deposit_holding ON saving_deposit (holding_id);

-- Recreated exactly as 018 wrote it and 019 kept it.
CREATE UNIQUE INDEX saving_deposit_source
  ON saving_deposit (source_kind, source_ref_id)
  WHERE deleted_at IS NULL AND source_kind <> 'MANUAL' AND source_ref_id IS NOT NULL;

-- 4 -------------------------------------------------------------------------
-- A goal's default lands in a holding too.
--
-- Not in the roadmap's sentence, and it follows from it: **money always lands in
-- a holding**, so the column that says where a goal's money lands by default
-- cannot go on naming a place. `applyPlanDeposit` writes through it, and a
-- default that resolved to a place would have to pick one of its holdings at
-- write time — the app choosing, silently, exactly where money goes.

CREATE TABLE saving_goal_new (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'EMERGENCY', 'SHORT_TERM', 'LONG_TERM', 'RETIREMENT',
                      'EARMARKED')),
  target_currency   TEXT,
  target_amount_minor INTEGER,
  target_date       TEXT,
  default_holding_id TEXT REFERENCES holding (id),
  emergency_months_bp INTEGER,
  emergency_basis   TEXT CHECK (emergency_basis IN ('FIXED_EXPENSES', 'TOTAL_SPENDING')),
  is_closed         INTEGER NOT NULL DEFAULT 0,
  priority          INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- NULL stays NULL: a goal with no default still has none, and `'h-' || NULL` is
-- NULL in SQLite, so the CASE is for the reader rather than for the engine.
INSERT INTO saving_goal_new (
  id, name, kind, target_currency, target_amount_minor, target_date,
  default_holding_id, emergency_months_bp, emergency_basis, is_closed, priority,
  note, created_at, updated_at, deleted_at
)
SELECT
  id, name, kind, target_currency, target_amount_minor, target_date,
  CASE WHEN default_holding_place_id IS NULL THEN NULL
       ELSE 'h-' || default_holding_place_id END,
  emergency_months_bp, emergency_basis, is_closed, priority,
  note, created_at, updated_at, deleted_at
FROM saving_goal;

DROP TABLE saving_goal;

ALTER TABLE saving_goal_new RENAME TO saving_goal;

CREATE INDEX saving_goal_priority ON saving_goal (is_closed, priority, name);
