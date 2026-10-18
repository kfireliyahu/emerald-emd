-- 011_reapply — what a re-apply changed, so it can be changed back.
--
-- Numbered and immutable after release (D-020). See docs/f03-auto-categorization-engine.md
-- ("Re-apply"), docs/04-data-model.md and D-045.
--
-- This is **the app's first undo**, and it is deliberately not a general one.
-- There is no command stack and no journal of every mutation: there is a record
-- of the rows one explicit bulk operation changed, and what they held before.
-- A user who runs the rules over four years of history needs exactly one
-- sentence back — "that was not what I wanted" — and a general undo would be a
-- much larger thing built to answer a question nobody has asked yet.

CREATE TABLE reapply_run (
  id            TEXT PRIMARY KEY NOT NULL,
  -- What the user chose, in the words the panel showed them. Stored rather than
  -- rebuilt: the accounts and categories it names can be renamed afterwards,
  -- and the undo prompt has to say what was actually done at the time.
  scope         TEXT NOT NULL,
  changed_count INTEGER NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT 0,
  -- Null while the run can still be undone. Set once, never cleared: undoing an
  -- undo is a redo, which is a second mechanism and nobody has asked for it.
  undone_at     INTEGER
);

CREATE TABLE reapply_change (
  run_id         TEXT NOT NULL REFERENCES reapply_run (id),
  transaction_id TEXT NOT NULL REFERENCES "transaction" (id),
  -- What the row held before the run. Null category means it was uncategorized,
  -- which is what most of a first re-apply will be.
  previous_category_id TEXT REFERENCES category (id),
  previous_source      TEXT NOT NULL CHECK (previous_source IN (
                         'MANUAL', 'RULE', 'AI', 'INHERITED', 'NONE')),
  previous_rule_id     TEXT,
  PRIMARY KEY (run_id, transaction_id)
);

-- `MANUAL` is in that CHECK for completeness of the column's vocabulary, not
-- because a row can arrive holding it: re-apply never touches a manually
-- categorized transaction (D-009), and the query that gathers candidates
-- excludes them in SQL rather than trusting anything above it to remember.

-- "Is there anything to undo" is asked every time the panel opens, and it is
-- the newest run that has not been undone.
CREATE INDEX reapply_run_undoable ON reapply_run (created_at) WHERE undone_at IS NULL;
