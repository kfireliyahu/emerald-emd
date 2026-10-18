-- 040_row_constraints — what has to be true across the columns of one row.
-- See docs/04-data-model.md ("Formats"), D-259 and M24 U7.
--
-- Numbered and immutable after release (D-020).
--
-- The ledger's cross-column CHECKs say three things: a column required when an
-- enum is a member, at most one of several columns set, and a sign when an
-- enum is a member (D-252). Each is declared as structure and compiled by the
-- reconciler into a pair of triggers on the declared table, never typed as
-- SQL (D-216). This table is the declaration's half; the triggers are the
-- table's, named `<table>__check_<key>__insert` and `__update`.

CREATE TABLE format_constraint (
  format_name TEXT NOT NULL REFERENCES format (name),
  -- The constraint as its one sentence: `auto_track_ref is required only when
  -- auto_track_kind is MANUAL`, `at most one of a, b`, `amount is at most 0
  -- when direction is OUTFLOW`. Stored as the artefact writes it and parsed on
  -- read, as an identity's equation is: one spelling, and a person opening the
  -- file in another tool reads the rule rather than its parts.
  rule        TEXT NOT NULL,
  -- Why it has to hold, in the author's words. Prose, stored, never parsed.
  note        TEXT NOT NULL DEFAULT '',
  -- The order they are declared in, which is the order a person reads them.
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, position)
);
