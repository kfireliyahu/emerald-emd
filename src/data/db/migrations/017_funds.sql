-- 017_funds — pension, hishtalmut, gemel and managers' insurance: the accounts
-- and the balance readings transcribed from their reports. See
-- docs/f13-pension-and-hishtalmut.md, docs/04-data-model.md ("Long-term funds")
-- and D-066.
--
-- Numbered and immutable after release (D-020).
--
-- **Two tables, and almost nothing else.** The domain that reads them (D-066)
-- derives everything: expected contributions from the payslips, the deposit
-- reconciliation, the effective fee, returns. Three things survive that
-- re-derivation and so need a home here — what the user holds, what the fund
-- reported, and the one answer the user gave that nothing can recompute.
--
-- **There is no `contribution` table.** docs/f13 says expected contributions are
-- derived, and they are: `paycheck_line` × `deduction_type.linked_fund_account_id`,
-- recomputed on demand. Storing them would create a second copy of what a payslip
-- says, which would then need to be kept in step with the payslip that says it.

CREATE TABLE fund_account (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  fund_type         TEXT NOT NULL CHECK (fund_type IN (
                      'PENSION', 'STUDY_FUND', 'PROVIDENT', 'MANAGERS_INSURANCE',
                      'PROVIDENT_FOR_INVESTMENT')),
  -- The managing company, from the same reference table the accounts screen
  -- uses. Nullable: a user who does not know which entity manages an old policy
  -- still has the policy.
  institution_id    TEXT REFERENCES institution (id),
  policy_number     TEXT,
  investment_track  TEXT,
  -- `DORMANT` is the one that earns its place: an old employer's fund takes no
  -- deposits and still charges fees every year, and making that visible is half
  -- of why F13 exists. It is also what tells the reconciliation that nothing
  -- arriving is the correct answer rather than a missing deposit (D-066).
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
                      status IN ('ACTIVE', 'DORMANT', 'CLOSED')),
  -- Which job it belongs to. Free text rather than a reference: the employer of
  -- a fund from three jobs ago is a name on a report, not an entity the app
  -- tracks. `paycheck.employer_name` is free text for the same reason.
  employer_name     TEXT,
  -- Date-only, `YYYY-MM-DD`, never an epoch. D-023.
  opened_date       TEXT,
  -- What the study-fund liquidity date counts from. Deliberately separate from
  -- `opened_date` and never inferred from it: the gap between the two is however
  -- long the first deposit took, and a liquidity date wrong by that much is
  -- worse than none.
  first_deposit_date TEXT,
  -- **Integer basis points, not a decimal** (D-066). 50 is 0.5%; 600 is 6%.
  -- docs/04 said `decimal?` for both of these until this migration. A decimal
  -- fee multiplied against a balance is a float in the money path, which D-003
  -- forbids and which D-056 already decided the same way for allocation
  -- percentages.
  fee_on_accumulation_bp INTEGER,
  fee_on_deposit_bp      INTEGER,
  -- Fee agreements expire and silently revert to the default. A date with a
  -- warning three months out is worth more than it costs (docs/f13).
  fee_negotiated_until   TEXT,
  -- Almost never updated after a marriage or a child. A nudge field, and free
  -- text on purpose: the app has no business modelling a family.
  beneficiaries     TEXT,
  notes             TEXT,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- The funds screen's order: active funds first, then dormant, then closed, and
-- the archived ones filtered out before that. The status leads because the
-- screen is two sections and the sections are this column.
CREATE INDEX fund_account_status ON fund_account (status, name);

CREATE TABLE fund_balance_snapshot (
  id                TEXT PRIMARY KEY NOT NULL,
  fund_account_id   TEXT NOT NULL REFERENCES fund_account (id),
  as_of_date        TEXT NOT NULL,
  -- One currency for the whole reading, as `paycheck` holds one for its lines
  -- (D-003). Every amount below is minor units in it.
  currency          TEXT NOT NULL,
  total_balance_minor INTEGER NOT NULL,
  -- The three components have different tax and withdrawal rules and the reports
  -- usually break them out. NULL where the report did not — which is a different
  -- fact from a component of zero, and is why these are nullable rather than
  -- defaulted (D-066: what they fail to account for is named, never folded in).
  employee_minor    INTEGER,
  employer_minor    INTEGER,
  severance_minor   INTEGER,
  -- What the fund says it received since the previous snapshot. The number the
  -- whole reconciliation turns on.
  --
  -- **May be negative.** docs/f13 records a severance withdrawal as exactly
  -- that: a negative movement with a note.
  deposits_minor    INTEGER,
  -- What the fund says it charged. The only way to see the fee actually paid,
  -- as opposed to the one the policy claims.
  fees_charged_minor INTEGER,
  -- What the report prints as its return. **Never what the app computes** — the
  -- app's figure is derived from a snapshot pair and the contributions between
  -- them (D-066), and storing one would create two answers to one question.
  return_minor      INTEGER,
  source            TEXT NOT NULL DEFAULT 'MANUAL' CHECK (
                      source IN ('MANUAL', 'REPORT_ENTRY', 'IMPORTED')),
  -- The user chased the deposit gap ending at this snapshot and found it
  -- explained — a late employer, a correction next quarter, a timing offset.
  --
  -- **The one stored fact in an otherwise derived feature** (D-066). Everything
  -- else here is recomputed from payslips and snapshots every time; this lives
  -- only in the user's head until they record it. A column rather than a table
  -- because a reconciliation window is identified by the snapshot that closes
  -- it, which is a row that already exists — D-061's argument, and the opposite
  -- of D-053's, whose dismissal had no row to hang off.
  deposit_gap_acknowledged INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- One reading per fund per date, among the living — docs/04's invariant. Two
-- readings for one day would make "since previous" mean nothing, and the window
-- the reconciliation walks would have a zero-length step in it.
--
-- Partial on `deleted_at IS NULL` for the reason `transaction_natural_key` is:
-- SQLite treats NULLs in a unique index as distinct, so unique-among-the-living
-- has to be spelled out.
CREATE UNIQUE INDEX fund_balance_snapshot_date
  ON fund_balance_snapshot (fund_account_id, as_of_date)
  WHERE deleted_at IS NULL;

-- **No foreign key is added to `deduction_type.linked_fund_account_id`**, and it
-- is not an oversight.
--
-- Migration 012 left that column without one because none of the three tables it
-- can point at existed. `fund_account` now does, so the constraint has become
-- writable — but writing it would mean rebuilding `deduction_type` (SQLite
-- cannot add a constraint to an existing column), which means dropping and
-- recreating a table that `paycheck_line` holds ids into, on every document that
-- already exists, to gain **nothing that is enforced**: this app never runs
-- `PRAGMA foreign_keys = ON`, so every REFERENCES clause in this schema is
-- documentation. Rebuilding a live table for a comment is a bad trade.
--
-- What actually keeps the link honest is the repository: `listFundLinkedTypes`
-- reads the two together, and clearing a fund clears the links that named it.
--
-- The other two links stay as they are for the original reason — `saving_goal`
-- and `debt` still do not exist.
