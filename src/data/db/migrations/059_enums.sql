-- 059_enums — several members of a list in one column, and a reading that splits a cell.
-- See docs/04-data-model.md ("Formats"), D-398 and M34 U5.
--
-- Numbered and immutable after release (D-020).
--
-- Tags, categories and ingredients were multi-selects in an export, and a trial
-- flattened them into comma-separated text — the untyped storage D-209 says
-- forfeits every CHECK. `enums` is the sixteenth type: several members of the
-- list the declaration names. Like `links` it has no column in the declared
-- table — each member is a row of `fmt_<format>__<column>`, whose own CHECK
-- names the list — and the reconciler makes that table, so this migration
-- only lets `format_column` say the word.

-- 1 -------------------------------------------------------------------------
-- SQLite cannot alter a CHECK in place, so `format_column` is rebuilt and
-- copied — the dance 035, 036, 039, 053, 054 and 056 did before it. Every row
-- is copied as it is, `found_by` (058) included.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Sixteen now, and still closed for D-114's reason. Declaration language
  -- 22 is required to say `enums`.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity', 'decimal', 'month', 'instant', 'links',
                'percent', 'time', 'enums')),
  unit        TEXT,
  per         TEXT,
  required    INTEGER NOT NULL CHECK (required IN (0, 1)),
  is_unique   INTEGER NOT NULL DEFAULT 0 CHECK (is_unique IN (0, 1)),
  scale       INTEGER CHECK (scale IS NULL OR scale BETWEEN 1 AND 9),
  minimum     REAL,
  maximum     REAL,
  target      TEXT,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  found_by    TEXT,
  PRIMARY KEY (format_name, name)
);

INSERT INTO format_column_new
  (format_name, name, type, unit, per, required, is_unique, scale, minimum, maximum, target, note, position, found_by)
SELECT format_name, name, type, unit, per, required, is_unique, scale, minimum, maximum, target, note, position, found_by
  FROM format_column;

DROP TABLE format_column;

ALTER TABLE format_column_new RENAME TO format_column;

-- 2 -------------------------------------------------------------------------
-- What splits a cell of the file into members, for a column read onto an
-- `enums` key — `,` for `vegan, quick`. Stated by the reading, never guessed;
-- empty for every other column, where a cell is one value.
ALTER TABLE format_intake_column ADD COLUMN separator TEXT;
