-- 013_fixed_expenses — the recurring bills that leave every month regardless of
-- behavior, and which the splitter takes off the top. See
-- docs/f09-fixed-monthly-expenses.md, docs/04-data-model.md ("Fixed expenses")
-- and D-053.
--
-- Numbered and immutable after release (D-020).
--
-- **One table, not two.** docs/04 lists `FixedExpenseCandidate` beside
-- `FixedExpense`; only one of them is a row. A candidate is regenerated from the
-- ledger every time the screen asks (docs/f09), so storing it would be storing a
-- derived answer that goes stale the moment a statement is imported — the same
-- reasoning that keeps a saving goal's balance and a fund's return out of the
-- schema. Only confirmation creates a row here.
--
-- **A dismissed candidate is not a row either.** "The user said no to this
-- merchant" is remembered under the `app_setting` key `fixedExpenses.dismissed`,
-- weighed exactly as D-049 weighed rows against shipped data and coming out the
-- other way: nothing holds a foreign key to a dismissal, it carries no state
-- beyond membership and the moment it was added, and it is keyed on a merchant
-- string rather than on anything with an id. A table would buy a query surface
-- for a set of a dozen strings the detector already has in memory. D-053.

CREATE TABLE fixed_expense (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  category_id       TEXT REFERENCES category (id),
  -- How future occurrences are recognized. `PAYCHECK_DEDUCTION` is the one that
  -- carries arithmetic rather than description: that money is already out of
  -- net, so subtracting it from net again makes every plan wrong by its amount
  -- (docs/f09 calls it the most dangerous bug in this feature). The rule is
  -- enforced in one place, `fixedExpenseBasis`, and this column is what it
  -- reads.
  match_kind        TEXT NOT NULL CHECK (match_kind IN (
                      'MERCHANT_PATTERN', 'CATEGORY', 'PAYCHECK_DEDUCTION', 'MANUAL_ONLY')),
  -- The merchant pattern, category id or deduction type id the kind names.
  -- Deliberately without REFERENCES: three of the four kinds point at different
  -- tables and one points at no table at all, so a foreign key here could only
  -- be right a quarter of the time.
  match_ref         TEXT,
  -- **The whole charge, not the monthly share.** A ₪1,200 annual premium stores
  -- 120000 and contributes ₪100 to a month's projection; amortization is
  -- `monthlyShare`, and the month the real charge lands in is `isChargeMonth`.
  -- Storing the share instead would lose the figure the user actually pays and
  -- make the annual total a multiplication of a rounded number.
  expected_minor    INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  amount_variability TEXT NOT NULL DEFAULT 'FIXED' CHECK (
                      amount_variability IN ('FIXED', 'VARIABLE')),
  cadence           TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (
                      cadence IN ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR')),
  day_of_month_hint INTEGER,
  -- Fixed and necessary are different axes (docs/08 B1, landing here as it said
  -- it would). A gym membership is fixed and cuttable; rent is fixed and not.
  -- Knowing which fixed costs *could* be cut is more useful than the total.
  is_discretionary  INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'USER_DEFINED' CHECK (
                      source IN ('USER_DEFINED', 'DETECTED_CONFIRMED', 'DETECTED_PENDING')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  -- Date-only, `YYYY-MM-DD`, never an epoch (D-023). `started_at` is also the
  -- **cadence anchor**: which months a non-monthly charge actually falls in is
  -- counted in whole cycles from it, which is why a bimonthly bill with no start
  -- date reports no charge month rather than guessing one.
  started_at        TEXT,
  -- A cancelled subscription stops polluting projections from here.
  ended_at          TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- "Is this merchant already tracked" — what the detector asks before offering a
-- candidate, and what confirming one looks up so that confirming twice updates
-- rather than duplicates (F09's idempotency criterion).
--
-- **Not unique.** One merchant can bill for two different things — a landlord
-- who takes rent and parking as separate standing orders — and a unique index
-- would refuse the second one with a constraint error the user cannot act on.
-- Idempotency is enforced in the repository, which can explain itself, exactly
-- as `deleteCategory` refuses rather than cascading.
CREATE INDEX fixed_expense_match ON fixed_expense (match_kind, match_ref);
CREATE INDEX fixed_expense_active ON fixed_expense (is_active, deleted_at);

-- **No "also tracked as a debt" column**, which docs/f09's edge-case table might
-- have suggested. The overlap it describes is already expressible from the other
-- side: a `Debt` carries `autoTrackKind` and `autoTrackRef` (M6), and a debt
-- tracked by `MERCHANT_PATTERN` names the same string this row's `match_ref`
-- does. M6 computes the collision by comparing the two rather than asking the
-- user to maintain a flag that says what both tables already know.
