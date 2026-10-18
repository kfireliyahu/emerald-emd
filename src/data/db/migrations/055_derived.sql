-- 055_derived — a column worked out from other columns.
-- See docs/04-data-model.md ("Formats"), D-334 and M29 U3b.
--
-- Numbered and immutable after release (D-020).
--
-- A derived column is an expression in the identity grammar, kept here as it
-- was typed and parsed by the engine whenever it is read. It stores no cell:
-- the reconciler compiles every format's derived columns into one view,
-- `fmt_<name>__derived`, from the parsed tree — never from this text — so the
-- figures are computed on read and anything that opens the file can query
-- them. Declaration language 16 is required to declare one.

CREATE TABLE format_derived (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  expression  TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);
