-- 012_paychecks — the income side: a payslip, its lines, and the vocabulary a
-- line names. See docs/f04-paycheck-tracking.md, docs/04-data-model.md
-- ("Income") and D-048 / D-049.
--
-- Numbered and immutable after release (D-020).
--
-- Two shapes decided here rather than left to the entry screen:
--
-- 1. **One deduction type, two amount columns.** Pension is one row of the
--    vocabulary and one line on the slip carrying an employee amount and an
--    employer amount, not two types spelling the same fact twice (D-048).
-- 2. **The built-in types are rows in the document**, seeded below exactly as
--    002 seeds categories and 006 seeds institutions — unlike the built-in
--    rules of D-046, which the app holds and the document only disagrees with.
--    A `paycheck_line` holds a real foreign key into this table, and a type
--    carries per-document state (its links, its flags, its order) that has to
--    live somewhere anyway (D-049).

CREATE TABLE deduction_type (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  -- What the slip calls it. Matching against a payslip is what this is for, so
  -- it is stored as the slip prints it and normalized when compared.
  hebrew_name       TEXT,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'TAX', 'SOCIAL_INSURANCE', 'HEALTH', 'PENSION', 'STUDY_FUND',
                      'SEVERANCE', 'LOAN_REPAYMENT', 'UNION', 'BENEFIT_IN_KIND',
                      'OTHER_DEDUCTION', 'ADDITION')),
  -- The two flags docs/f04 exists to get right: whether the money actually left
  -- take-home pay, and whether it is wealth rather than spending. Getting either
  -- wrong makes the savings rate and total compensation nonsense.
  reduces_net       INTEGER NOT NULL DEFAULT 1,
  counts_as_saving  INTEGER NOT NULL DEFAULT 0,
  -- Where a line of this type routes to. Deliberately without REFERENCES: none
  -- of the three tables exists yet (SavingGoal and FundAccount in M5, Debt in
  -- M6), and a foreign key to a table that is not there would be a lie the
  -- schema tells until the migration that makes it true.
  linked_saving_goal_id  TEXT,
  linked_debt_id         TEXT,
  linked_fund_account_id TEXT,
  -- Seeded rows are built-in: they can be edited and switched off, and cannot
  -- be deleted out from under a paycheck that names them.
  is_built_in       INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

CREATE TABLE paycheck (
  id                TEXT PRIMARY KEY NOT NULL,
  -- The salary month, `YYYY-MM`. Not the month it was paid in: a January salary
  -- paid on 9 February is January's.
  period            TEXT NOT NULL,
  -- Date-only, `YYYY-MM-DD`, never an epoch. D-023.
  payment_date      TEXT NOT NULL,
  employer_name     TEXT,
  -- Minor units plus one currency for the whole slip (D-003). A payslip is
  -- denominated in one currency, so the lines take theirs from here rather than
  -- carrying a copy that can drift.
  gross_minor       INTEGER NOT NULL,
  net_minor         INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  -- Lets M5 match the deposit in a bank statement against the slip that
  -- produced it (docs/f06).
  deposited_to_account_id TEXT REFERENCES account (id),
  note              TEXT,
  source_kind       TEXT NOT NULL DEFAULT 'MANUAL' CHECK (
                      source_kind IN ('MANUAL', 'PDF_PARSED', 'AI_PARSED')),
  attachment_ref    TEXT,
  -- A 13th salary or a bonus month, which averages exclude. Detected as an
  -- outlier against the median and **confirmed by the user** (docs/05), which
  -- is why it is stored: the confirmation is the part that cannot be re-derived.
  is_irregular      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- Deliberately **not** unique on (period, employer_name), which is what docs/04
-- asked for. docs/f04's own edge cases allow a 13th salary in the same period as
-- the regular slip from the same employer, and those two statements cannot both
-- hold. The index that would enforce it would fire on the one case the feature
-- promises to support, at the moment the user is copying a real slip. Entry
-- warns about a second paycheck for a period instead; the app must never argue
-- with the slip (D-048).
CREATE INDEX paycheck_period ON paycheck (period, employer_name);
CREATE INDEX paycheck_payment_date ON paycheck (payment_date);

CREATE TABLE paycheck_line (
  id                TEXT PRIMARY KEY NOT NULL,
  paycheck_id       TEXT NOT NULL REFERENCES paycheck (id),
  deduction_type_id TEXT NOT NULL REFERENCES deduction_type (id),
  -- **Magnitudes, not signed amounts.** D-004's sign convention is about a
  -- transaction's direction; a deduction line is "how much was taken", and the
  -- direction is the type's `reduces_net`. A signed column here would mean the
  -- reconciliation formula and the number on the slip disagree about the minus.
  employee_minor    INTEGER NOT NULL DEFAULT 0,
  -- The employer's side of the same line: never out of net, but real money the
  -- user owns or accrues. NULL where the type has no employer side at all,
  -- which is different from an employer share of zero (D-048).
  employer_minor    INTEGER,
  -- The salary base a percentage applied to, when the slip prints one.
  basis_minor       INTEGER,
  note              TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0
);

-- Lines have no soft delete: they are not addressed by anything outside their
-- paycheck, and editing a slip replaces them wholesale. The paycheck is the
-- record that is soft-deleted, and its lines go with it.
CREATE INDEX paycheck_line_paycheck ON paycheck_line (paycheck_id, sort_order);
-- "Which paychecks used this type" — what deleting a deduction type has to ask,
-- and what F13's expected contributions will read.
CREATE INDEX paycheck_line_type ON paycheck_line (deduction_type_id);

-- The built-in vocabulary. Stable readable ids, as 002 and 006 use, so
-- re-seeding is a no-op and a later migration can point at one without a lookup.
--
-- Israeli payroll vocabulary is closed enough that this list does not grow every
-- release — which is the other half of why these are rows and D-046's rules are
-- not (D-049).
--
-- No `– employee` / `– employer` pairs: pension, study fund and severance are
-- one type each, and the employer's share is the second amount on the line
-- (D-048).
INSERT INTO deduction_type (
  id, name, hebrew_name, kind, reduces_net, counts_as_saving, is_built_in, sort_order
) VALUES
  ('ded:income-tax',        'Income tax',        'מס הכנסה',       'TAX',              1, 0, 1, 10),
  ('ded:national-insurance','National insurance','ביטוח לאומי',    'SOCIAL_INSURANCE', 1, 0, 1, 20),
  ('ded:health-tax',        'Health tax',        'מס בריאות',      'HEALTH',           1, 0, 1, 30),
  ('ded:pension',           'Pension',           'פנסיה',          'PENSION',          1, 1, 1, 40),
  ('ded:study-fund',        'Study fund',        'קרן השתלמות',    'STUDY_FUND',       1, 1, 1, 50),
  -- Employer-side only: severance accrues to the user without ever touching net.
  ('ded:severance',         'Severance',         'פיצויים',        'SEVERANCE',        0, 1, 1, 60),
  ('ded:union-dues',        'Union dues',        'דמי ועד',        'UNION',            1, 0, 1, 70),
  -- Notional: both inflate gross for tax without being cash, so neither reduces
  -- net. A slip that also prints an offsetting deduction line records that line
  -- as what it is — an amount that did come out of net.
  ('ded:meal-card',         'Meal card',         'כרטיס הסעדה',    'BENEFIT_IN_KIND',  0, 0, 1, 80),
  ('ded:company-car',       'Company car value', 'שווי רכב',       'BENEFIT_IN_KIND',  0, 0, 1, 90),
  -- What the reconciliation strip's one-tap "add the difference" writes
  -- (docs/f04, entry flow step 4). Last, because it is the fallback.
  ('ded:other',             'Other deduction',   'ניכוי אחר',      'OTHER_DEDUCTION',  1, 0, 1, 100);
