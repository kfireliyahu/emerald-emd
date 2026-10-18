-- 022_fund_deposits — the per-deposit table a fund report prints, one row per
-- deposit. See docs/f13-pension-and-hishtalmut.md, docs/04-data-model.md
-- ("FundDeposit") and D-153.
--
-- Numbered and immutable after release (D-020).
--
-- **This is the one thing D-152 left unread, and it is what the deposit
-- reconciliation actually wants.** Until now a fund's deposits were one figure
-- per reading — "₪24,000 since the last snapshot" — compared against the
-- payslips of a window guessed at through a lag, because a payroll month and a
-- deposit date are not the same month and nothing said by how much. A report's
-- deposit table states the answer outright: **every row names the salary month
-- it is for**, so the lag stops being a parameter and becomes a fact read off
-- the page.
--
-- **A row belongs to the reading that transcribed it**, not to the fund
-- directly, and `snapshot_id` is therefore NOT NULL. A deposit is something a
-- report *said*, exactly as a balance is; deleting the reading takes its rows
-- with it, because what is left otherwise is a figure with nothing behind it.
--
-- **Two reports may state the same deposit and both rows are kept.** An Israeli
-- quarterly is year-to-date (D-152), so Q2's table repeats every row of Q1's.
-- Storing one of them would mean deciding which report to disbelieve; storing
-- both keeps each reading a faithful transcription of its own document, and the
-- domain dedupes by natural key when it aggregates (`distinctDeposits` in
-- `domain/funds.ts`). That is the same shape as every other fund figure here:
-- **transcribed faithfully, reconciled afterwards.**
--
-- **Every amount is nullable and absent means the report did not print it**,
-- which is `fund_balance_snapshot`'s rule for its components and for the same
-- reason: a fund that received nothing and a report that did not break the
-- figure down are different facts, and the checks branch on the difference. A
-- row with no amount at all is not a row and never reaches here.

CREATE TABLE fund_deposit (
  id                TEXT PRIMARY KEY NOT NULL,
  fund_account_id   TEXT NOT NULL REFERENCES fund_account (id),
  -- The reading this row was transcribed from. The report is the evidence, and
  -- a deposit with no report behind it is a number somebody typed.
  snapshot_id       TEXT NOT NULL REFERENCES fund_balance_snapshot (id),
  -- Who paid it in. Free text, as `fund_account.employer_name` is and for the
  -- same reason: an employer on a report is a name, not an entity this app
  -- tracks. NULL where the table has no employer column.
  employer_name     TEXT,
  -- When the money reached the fund. Date-only, `YYYY-MM-DD`, never an epoch
  -- (D-023).
  deposit_date      TEXT,
  -- **The salary month this deposit is FOR**, as `YYYY-MM`, and the column this
  -- table exists for. A deposit made on 04/01/2026 for 11/2025 is late, and no
  -- aggregate figure anywhere can say so.
  salary_month      TEXT,
  -- One currency per row, as `fund_balance_snapshot` holds one for its whole
  -- reading (D-003). Every amount below is minor units in it.
  currency          TEXT NOT NULL,
  employee_minor    INTEGER,
  employer_minor    INTEGER,
  severance_minor   INTEGER,
  -- What the row's own total column said, where it has one. **Not the sum** —
  -- deriving that is `depositTotal`, and storing a sum the document did not
  -- print would be a second copy of the three columns beside it.
  total_minor       INTEGER,
  -- The salary the deposit was computed on, where the table prints it. Nothing
  -- reconciles against it yet; it is on the page and throwing it away is how
  -- D-152 happened.
  salary_minor      INTEGER,
  source            TEXT NOT NULL DEFAULT 'REPORT_ENTRY' CHECK (
                      source IN ('MANUAL', 'REPORT_ENTRY')),
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- The reconciliation's own read: every deposit to one fund, in salary-month
-- order, which is the order the answer is printed in.
CREATE INDEX fund_deposit_month ON fund_deposit (fund_account_id, salary_month);

-- And the reading's own rows, which is how they are replaced: saving a reading
-- writes its table whole rather than merging into it.
CREATE INDEX fund_deposit_snapshot ON fund_deposit (snapshot_id);

-- **There is deliberately no unique index here.** The obvious one — a fund, a
-- salary month, an employer and a date — would reject the second of two reports
-- that overlap, which is every consecutive pair of Israeli quarterlies, and it
-- would also reject a genuine correction deposit made twice in one month. The
-- duplicate this table can produce is *the same report read twice*, which the
-- unique index on `fund_balance_snapshot (fund_account_id, as_of_date)` already
-- prevents one level up.
