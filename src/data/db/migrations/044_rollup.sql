-- 044_rollup — a figure keyed by a month and perhaps a link, over a format's
-- own rows. See docs/04-data-model.md ("Formats"), D-267, D-271 and M25 E2.
--
-- Numbered and immutable after release (D-020).
--
-- A rollup is compiled to one GROUP BY when it is read and never stored, as an
-- aggregate is (D-222): this table is the declaration and nothing else.

CREATE TABLE format_rollup (
  format_name TEXT NOT NULL REFERENCES format (name),
  -- What the view is asked for by: `spending`. Unique within the format.
  name        TEXT NOT NULL,
  -- The rollup as its one sentence — `sum of amount by month of charge_date
  -- and category where direction is OUTFLOW` — stored as the artefact writes
  -- it and parsed on read, as a constraint's rule is.
  works_out   TEXT NOT NULL,
  -- Why it is worth declaring, in the author's words. Prose, never parsed.
  note        TEXT NOT NULL DEFAULT '',
  -- The order they are declared in.
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);
