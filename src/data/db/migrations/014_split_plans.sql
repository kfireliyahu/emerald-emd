-- 014_split_plans — the splitter: where the next net paycheck is meant to go.
-- See docs/f05-paycheck-splitter.md, docs/04-data-model.md ("Planning") and
-- D-056.
--
-- Numbered and immutable after release (D-020).
--
-- This is the app's forward-looking half. Nothing here records what happened;
-- it records what the user intends, which is why no row in these three tables
-- is derived from a transaction and applying a plan changes nothing without
-- confirmation (docs/f05).
--
-- Two of docs/04's fields are deliberately not columns, each because it was a
-- second name for something the model already had — the call D-037 made about
-- three `CategoryRule` fields:
--
-- 1. **`subtractFixedExpenses`** is `fixed_expense_mode <> 'NONE'`. Two fields
--    that can disagree about one fact is a bug with a schema behind it.
-- 2. **`percentage` as a decimal** would put a float in the money path's
--    vicinity. Rates in this app are integer basis points and always have been
--    (docs/05), so the column is `basis_points`: 2350 is 23.5%.

CREATE TABLE split_plan (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  basis_kind        TEXT NOT NULL DEFAULT 'LAST_PAYCHECK' CHECK (basis_kind IN (
                      'LAST_PAYCHECK', 'AVERAGE_LAST_N', 'SPECIFIC_PAYCHECK', 'CUSTOM_AMOUNT')),
  -- Whichever the basis needs; the other two stay null.
  basis_paycheck_id TEXT REFERENCES paycheck (id),
  basis_months      INTEGER,
  custom_amount_minor INTEGER,
  -- One currency for the whole plan, as a paycheck holds one for its lines
  -- (012). Allocations take theirs from here rather than carrying a copy that
  -- can drift from the total it is supposed to add up to.
  currency          TEXT NOT NULL,
  -- What comes off the top before splitting (docs/f09). `NONE` is the whole of
  -- "do not subtract" — see note 1 above.
  fixed_expense_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (
                      fixed_expense_mode IN ('NONE', 'ESTIMATED', 'CONFIRMED_ONLY')),
  is_default        INTEGER NOT NULL DEFAULT 0,
  -- `YYYY-MM`, set when the plan is committed for a month. The apply flow that
  -- writes it is a later unit; the column is here because docs/04 asks for it
  -- and a migration per field is the cost this table exists to avoid.
  applied_to_period TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- **Buckets are not owned by a plan.** docs/04 draws
-- `SplitPlan ──< Allocation ──> SplitBucket`, and that shape is what makes
-- "Default" and "Bonus month" comparable: the same six destinations, different
-- percentages. A `plan_id` here would make comparing two plans a name-matching
-- exercise.
CREATE TABLE split_bucket (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  -- **All five values ship now**, including the two whose tables do not exist
  -- until M5 and M6. A CHECK constraint cannot be altered in SQLite without
  -- rebuilding the table, and migrations are immutable after release (D-020),
  -- so the vocabulary is the one thing here that has to be complete on day one.
  -- Which of them the *screen* offers is a different question with a different
  -- answer, and it is answered on the screen (D-056).
  target_kind       TEXT NOT NULL DEFAULT 'FREE' CHECK (target_kind IN (
                      'CATEGORY', 'SAVING_GOAL', 'DEBT', 'FIXED_EXPENSES', 'FREE')),
  -- Deliberately without REFERENCES: it points at four different tables
  -- depending on the kind, so a foreign key could only ever be right a quarter
  -- of the time. A target that has gone missing is reported by
  -- `orphanedBuckets` and read as FREE, and the row is left alone so that
  -- restoring the category restores the bucket with it (docs/f05).
  target_id         TEXT,
  color             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  -- Absorbs the **rounding** leftover — the agorot floor division threw away,
  -- never more than one per other bucket. Not to be confused with a REMAINDER
  -- allocation, which absorbs the **balance**: everything the plan did not
  -- assign, which can be thousands. docs/04 and docs/05 describe both and it is
  -- easy to read them as one thing.
  is_buffer         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

CREATE INDEX split_bucket_order ON split_bucket (sort_order, name);

CREATE TABLE allocation (
  id                TEXT PRIMARY KEY NOT NULL,
  plan_id           TEXT NOT NULL REFERENCES split_plan (id),
  bucket_id         TEXT NOT NULL REFERENCES split_bucket (id),
  mode              TEXT NOT NULL DEFAULT 'PERCENTAGE' CHECK (
                      mode IN ('PERCENTAGE', 'FIXED_AMOUNT', 'REMAINDER')),
  -- Integer basis points of the splittable amount. See note 2 above.
  basis_points      INTEGER,
  amount_minor      INTEGER,
  -- A locked allocation never moves when another slider is dragged (docs/f05).
  is_locked         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0
);

-- Allocations have no soft delete: they are not addressed by anything outside
-- their plan, and editing a plan replaces them. The plan is what is
-- soft-deleted, and its allocations go with it.
CREATE INDEX allocation_plan ON allocation (plan_id);

-- Two invariants docs/04 states, and unlike 013's merchant case there is no
-- legitimate reading that violates either — so they are constraints rather than
-- repository checks. A bucket appears at most once in a plan (two rows for one
-- destination is a plan that cannot be drawn as a bar), and at most one
-- allocation per plan takes the remainder (two would both claim what is left).
CREATE UNIQUE INDEX allocation_one_per_bucket ON allocation (plan_id, bucket_id);
CREATE UNIQUE INDEX allocation_one_remainder ON allocation (plan_id) WHERE mode = 'REMAINDER';
