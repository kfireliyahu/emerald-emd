-- 049_column_view — how a format's columns are shown, kept beside the format.
-- See docs/04-data-model.md ("Formats"), D-289 and M26 U2.
--
-- Numbered and immutable after release (D-020).
--
-- **Presentation, so never the declaration** (M26 U2): a width says nothing
-- about what a column holds, and a declaration that carried one would change
-- every time somebody dragged a header. It is kept per document because it
-- was asked for there (2026-10-01), and beside the format rather than in
-- it, which is where M26 U6's entry view is meant to live too.
--
-- No foreign key to format_column: a declaration is rewritten whole on every
-- save (saveFormat), and a width for a column that has gone is read by nobody
-- and dropped from the text. deleteFormat clears a format's rows here.

CREATE TABLE format_column_view (
  format_name TEXT NOT NULL REFERENCES format (name),
  column_name TEXT NOT NULL,
  -- In CSS pixels. Bounded so a hand-edited file cannot hide a column or push
  -- the sheet off the screen.
  width       INTEGER NOT NULL CHECK (width BETWEEN 48 AND 1200),
  PRIMARY KEY (format_name, column_name)
);
