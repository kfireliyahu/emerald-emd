-- 038_unique — a declared column may say no two rows share its value.
-- See docs/04-data-model.md ("Formats"), D-255 and M24 U4.
--
-- Numbered and immutable after release (D-020).
--
-- **A flag on the declaration, and an index on the table.** The flag is here;
-- the index is the reconciler's, named `<table>__<column>__unique`, so a
-- document opened in another tool shows the constraint where SQLite keeps it.
-- An empty cell does not collide with another, which is SQLite's UNIQUE and
-- is also what an optional unique column means.
--
-- `ADD COLUMN` rather than the rebuild 035 and 036 needed: a new column may
-- carry a CHECK and a default, and nothing that is already there changes.
-- Every column declared before this is not unique, which is what it was.

ALTER TABLE format_column
  ADD COLUMN is_unique INTEGER NOT NULL DEFAULT 0 CHECK (is_unique IN (0, 1));
