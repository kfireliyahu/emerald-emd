-- 052_view_column — a view a format has, and what it keeps per column.
-- See docs/04-data-model.md ("Formats"), D-294 and M26 U6.
--
-- Numbered and immutable after release (D-020).
--
-- **Presentation, so never the declaration** (D-289's reason): which input
-- draws a column on the entry page says nothing about what the column holds.
-- Not more columns of format_column_view, as 049 expected: a width is required
-- of every row there, and a column given an input has none.
--
-- **One table for every view, not one per view.** `view` names the kind —
-- `entry` today — and `setting` is what that kind keeps for a column: for an
-- entry, its input. M27's board and roadmap are meant to be more kinds of the
-- same thing, so neither is fixed by a CHECK here; the code refuses a kind or
-- a setting it does not know, as it does a width out of bounds.
--
-- No foreign key to format_column, for 049's reason. deleteFormat clears a
-- format's rows here, and a rename moves them.

CREATE TABLE format_view_column (
  format_name TEXT NOT NULL REFERENCES format (name),
  view        TEXT NOT NULL CHECK (length(view) BETWEEN 1 AND 32),
  column_name TEXT NOT NULL,
  setting     TEXT NOT NULL CHECK (length(setting) BETWEEN 1 AND 32),
  PRIMARY KEY (format_name, view, column_name)
);
