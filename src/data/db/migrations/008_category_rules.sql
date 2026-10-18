-- 008_category_rules — the table `transaction.matched_rule_id` has been
-- pointing at since migration 002.
--
-- Numbered and immutable after release (D-020). See docs/f03-auto-categorization-engine.md,
-- docs/04-data-model.md ("CategoryRule") and D-037.
--
-- The engine that reads this table is `src/domain/categorization.ts`, and it is
-- a pure function over rows loaded into memory: a statement is a few hundred
-- rows against a rule set of tens, so ordering and matching belong in code that
-- can be unit-tested, not in SQL that cannot.

CREATE TABLE category_rule (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'EXACT_MERCHANT', 'CONTAINS', 'REGEX',
                  'PROVIDER_CATEGORY', 'AMOUNT_RANGE', 'ACCOUNT')),
  -- Meaning depends on `kind`, and is empty for the two condition-only kinds.
  pattern       TEXT NOT NULL DEFAULT '',
  target_category_id TEXT NOT NULL REFERENCES category (id),
  -- Lower wins, within an origin tier. Held as integers and re-normalized in
  -- steps of ten when the user drags a rule (D-037), so a reorder rewrites the
  -- rules it moved past and nothing else.
  priority      INTEGER NOT NULL DEFAULT 0,
  origin        TEXT NOT NULL DEFAULT 'USER' CHECK (origin IN (
                  'USER', 'LEARNED_FROM_CORRECTION', 'AI_SUGGESTED', 'BUILT_IN')),
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  -- Conditions, ANDed with whatever the kind itself tests. Bounds are
  -- magnitudes in one currency: the sign of an amount is the app's convention
  -- (D-004), so a signed bound would mean nothing the user typed.
  scope_account_id TEXT REFERENCES account (id),
  amount_min_minor INTEGER,
  amount_max_minor INTEGER,
  amount_currency  TEXT,
  -- What the "this rule never fires" view in docs/f03 reads.
  hit_count       INTEGER NOT NULL DEFAULT 0,
  last_matched_at INTEGER,
  created_at    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER
);

-- The engine loads the live rules in one go, in the order the two leading terms
-- of `compareRules` want them. The rest of that comparator is in TypeScript,
-- because "how specific is this kind" is a rule about kinds, not about rows.
CREATE INDEX category_rule_live
  ON category_rule (priority, created_at)
  WHERE deleted_at IS NULL;

-- A rule pointing at a category that was deleted is auto-disabled and surfaced
-- for repair (docs/f03, "Edge cases"), which needs this direction of the link
-- to be cheap to ask about.
CREATE INDEX category_rule_target ON category_rule (target_category_id);
