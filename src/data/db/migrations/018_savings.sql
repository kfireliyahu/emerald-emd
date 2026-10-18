-- 018_savings — saving goals, the deposits that make up their balances, and the
-- places the money physically sits. See docs/f07-savings-and-deposits.md,
-- docs/04-data-model.md ("Savings") and D-074.
--
-- Numbered and immutable after release (D-020).
--
-- **There is no balance column**, in either of the two tables that might have
-- wanted one, and that is the whole shape of this migration. A goal's balance is
-- Σ its deposits and a place's balance is Σ the deposits sitting in it; docs/f07
-- says drift in a savings number destroys trust faster than any other bug in
-- this app, and a stored total is a wrong answer with a timestamp the moment a
-- deposit is edited. The domain that reads these tables has no function that
-- accepts a balance at all (D-074), so there is nothing here for one to be
-- stored *for*.
--
-- This is the deliberate opposite of `fund_balance_snapshot`, which stores
-- balances because the app never sees a fund's own deposit stream and has
-- nothing to derive one from. Savings have the stream.

CREATE TABLE holding_place (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'CHECKING', 'DEPOSIT', 'INVESTMENT', 'PROVIDENT',
                      'STUDY_FUND', 'CASH', 'OTHER')),
  -- Bank or broker, as free text. Deliberately not `institution_id`: this names
  -- where money sits rather than an entity the importer maps files to, and a
  -- user with a brokerage the reference table has never heard of still has it.
  institution       TEXT,
  -- **The field the emergency-fund figure turns on.** Money reachable this week,
  -- as opposed to locked in a fixed deposit or a pension. It is the user's
  -- answer and not an inference from `kind`, because a פק"מ maturing next week
  -- and one with six months to run are the same kind and different answers.
  is_liquid         INTEGER NOT NULL DEFAULT 1,
  -- What this place is expected to earn a year, before charges: 400 is 4%.
  -- **Integer basis points**, as every rate in this app has been since D-003 —
  -- a decimal rate multiplied against a balance is a float in the money path.
  --
  -- The field F07's projection was blocked on: nothing in the model recorded an
  -- expected return, and a place is the thing that *has* one, where a goal is a
  -- purpose and can be spread across several places at different rates.
  expected_return_bp INTEGER,
  -- Whose rate it is. A פק"מ's stated interest is a fact the bank agreed to; an
  -- index fund's return is an assumption the user chose, and presenting the
  -- second as the first is the failure mode docs/f07 names.
  --
  -- **The two columns are one nullable field in the domain** (`ExpectedReturn`),
  -- so a rate can never be held without its provenance — and the basis is not
  -- decoration: only an `ASSUMED` rate moves between the projection's
  -- conservative / moderate / optimistic columns (D-074).
  expected_return_basis TEXT CHECK (
                      expected_return_basis IN ('CONTRACTUAL', 'ASSUMED')),
  note              TEXT,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- The "where is my money" view's order: liquid first, then locked, then by name.
-- The liquid flag leads because that breakdown is two sections and the sections
-- are this column.
CREATE INDEX holding_place_liquidity ON holding_place (is_liquid, name);

CREATE TABLE saving_goal (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'EMERGENCY', 'SHORT_TERM', 'LONG_TERM', 'RETIREMENT',
                      'EARMARKED')),
  -- Optional, and nullable as a **pair**: some goals are open-ended ("the house
  -- fund", with no number yet), and docs/f07 lists that as a case to support
  -- rather than an error to prevent. A currency with no amount would be a
  -- denomination for nothing.
  target_currency   TEXT,
  target_amount_minor INTEGER,
  -- Date-only, `YYYY-MM-DD`, never an epoch. D-023.
  target_date       TEXT,
  default_holding_place_id TEXT REFERENCES holding_place (id),
  -- "How much should be in the bank", as the two facts the app does not get to
  -- decide: how many months, and months of what.
  --
  -- **Basis points of one month**: 45,000 is 4.5 months. The received answer is
  -- three to six and the honest one depends on how stable the income is, which
  -- is the user's judgement — so the app supplies a slider, and a slider that
  -- could only step in whole months would be the app deciding half the question.
  -- Basis points because this is a rate multiplied against an amount (D-056,
  -- D-066).
  emergency_months_bp INTEGER,
  -- `FIXED_EXPENSES` is the floor — what `fixed_expense` amortizes into one
  -- monthly figure, with payroll deductions already excluded (D-053).
  -- `TOTAL_SPENDING` is the comfortable figure. Both are always shown; this is
  -- the one the multiplier applies to.
  emergency_basis   TEXT CHECK (emergency_basis IN ('FIXED_EXPENSES', 'TOTAL_SPENDING')),
  -- Reached or abandoned. Keeps its history and takes no new deposits.
  is_closed         INTEGER NOT NULL DEFAULT 0,
  -- Order for the splitter's bucket suggestions (F05).
  priority          INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- An emergency goal's target is **derived** from the multiplier and the month's
-- expenses, so it moves when the expenses do and there is nothing to keep in
-- step. A goal carrying both a multiplier and a stored amount would carry two
-- answers to one question, which `validateGoal` refuses in the form — stated
-- here too because the columns permit what the domain forbids.

CREATE INDEX saving_goal_priority ON saving_goal (is_closed, priority, name);

CREATE TABLE saving_deposit (
  id                TEXT PRIMARY KEY NOT NULL,
  goal_id           TEXT NOT NULL REFERENCES saving_goal (id),
  date              TEXT NOT NULL,
  currency          TEXT NOT NULL,
  -- **Negative for a withdrawal**, which is how docs/f07 models one: not a
  -- second entity, so a balance stays a single sum and a whole class of bugs
  -- has nowhere to live. The price is that a withdrawal has to carry its reason
  -- in `note`, which the domain requires.
  --
  -- Never zero. A deposit of nothing is a typo, not a record.
  amount_minor      INTEGER NOT NULL,
  holding_place_id  TEXT NOT NULL REFERENCES holding_place (id),
  source_kind       TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source_kind IN (
                      'MANUAL', 'FROM_TRANSACTION', 'FROM_PAYCHECK_DEDUCTION',
                      'FROM_PLAN')),
  -- The transaction, paycheck line or allocation that generated it. No
  -- REFERENCES: it points at three different tables depending on the kind, so a
  -- constraint could only be right a third of the time — the call D-056 made for
  -- `split_bucket.target_id`.
  source_ref_id     TEXT,
  -- The two legs of a move between holding places, tied together. They net to
  -- zero and are not contributions: ₪10,000 going from checking into a פק"מ must
  -- not read as saving ₪10,000 (docs/f07's edge case).
  transfer_group_key TEXT,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- The deposit list, the goal's history and every balance read the same two
-- columns in the same order.
CREATE INDEX saving_deposit_goal_date ON saving_deposit (goal_id, date);
CREATE INDEX saving_deposit_place ON saving_deposit (holding_place_id);

-- **One deposit per source ref** — docs/f07's idempotency invariant, and F07's
-- second acceptance criterion: a payroll-linked deposit is created exactly once
-- however often the paycheck is edited, and re-importing a statement updates the
-- deposit a transaction generated rather than adding another.
--
-- What "the same deposit" means is `depositSourceKey` in the domain, and the
-- repository's upsert reads the same definition this index enforces, so the two
-- cannot come to disagree.
--
-- `MANUAL` rows are excluded rather than being NULL-keyed: two identical manual
-- deposits on one day are two deposits, because the user made two. Partial on
-- `deleted_at IS NULL` for the reason every unique index here is — SQLite treats
-- NULLs as distinct, so unique-among-the-living has to be spelled out.
CREATE UNIQUE INDEX saving_deposit_source
  ON saving_deposit (source_kind, source_ref_id)
  WHERE deleted_at IS NULL AND source_kind <> 'MANUAL' AND source_ref_id IS NOT NULL;

-- **No foreign key is added to `deduction_type.linked_saving_goal_id`**, and it
-- is the same decision D-067 made about the fund link rather than a new one.
--
-- Migration 012 left all three link columns unconstrained because none of the
-- tables they point at existed. `saving_goal` now does, so this one has become
-- writable — and writing it would mean rebuilding `deduction_type`, which SQLite
-- requires for adding a constraint to an existing column, on every document that
-- already exists, dropping and recreating a table `paycheck_line` holds ids
-- into, to gain nothing that is enforced: this app never runs
-- `PRAGMA foreign_keys = ON`, so every REFERENCES clause in this schema is
-- documentation.
--
-- What keeps it honest is `deleteGoal`, which clears every type that named the
-- goal — because a link to a deleted goal would go on generating payroll
-- deposits for a goal nobody can see. Exactly what `deleteFund` does (D-067).
--
-- `linked_debt_id` stays as it is: `debt` still does not exist (M6).
