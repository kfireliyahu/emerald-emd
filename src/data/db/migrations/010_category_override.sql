-- 010_category_override — what the user changed a category from, and to.
--
-- Numbered and immutable after release (D-020). See docs/04-data-model.md
-- ("Audit of overrides"), docs/f03-auto-categorization-engine.md ("Learning
-- from corrections") and D-042.
--
-- docs/04 has listed this since the data model was written and nothing built
-- it, so correcting a category taught the app nothing: the rule set could only
-- grow on a screen most people never open. This table is what the offer after a
-- correction reads, and it is the only thing that can answer "you have put this
-- merchant in this category three times now".
--
-- The merchant is deliberately **not** a column here. It is on the transaction,
-- in the normalized form the engine matches against, and a copy taken at
-- override time would be a second spelling of one fact that can disagree with
-- the first (D-037). The repeat count joins.

CREATE TABLE category_override (
  id             TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES "transaction" (id),
  -- What the row had before. Null means it was uncategorized, which is the
  -- most common override there is.
  previous_category_id TEXT REFERENCES category (id),
  -- And where that came from: overruling a rule is a different act from
  -- filling in a blank, and the reason kind docs/04 asks for is read off this
  -- plus the two categories rather than stored beside them.
  previous_source TEXT NOT NULL CHECK (previous_source IN (
                    'MANUAL', 'RULE', 'AI', 'INHERITED', 'NONE')),
  -- Null when the user cleared the category rather than changing it.
  new_category_id TEXT REFERENCES category (id),
  created_at     INTEGER NOT NULL DEFAULT 0
);

-- No `deleted_at`, unlike every user-owned record in docs/04's soft-delete
-- list. An override is not a thing the user owns and edits; it is a record that
-- something happened, and a record of the past that can be rewritten is not
-- one. Nothing in the app deletes from this table.

-- "What has this row been through" — the provenance direction.
CREATE INDEX category_override_transaction ON category_override (transaction_id);

-- "How many times has this category been chosen by hand" — the direction the
-- three-repeat prompt counts in, before the join narrows it to one merchant.
CREATE INDEX category_override_category ON category_override (new_category_id);
