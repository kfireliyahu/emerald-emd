-- 053_links — a link to several rows.
-- See docs/04-data-model.md ("Formats"), D-300 and M27 U2.
--
-- Numbered and immutable after release (D-020).
--
-- A link held one row's id, so a unit blocked by three others and a decision
-- amended by two were written in prose. `links` is the thirteenth type: the
-- ids of several rows of another format, in order. It has no column of its
-- own in the declared table — each member is a row of `fmt_<format>__<column>`,
-- which the reconciler makes from the declaration like every declared table,
-- so this migration only lets `format_column` say the word.
--
-- SQLite cannot alter a CHECK in place, so `format_column` is rebuilt and
-- copied — the dance 035, 036 and 039 did before it. Every row is copied as it
-- is.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Thirteen now, and still closed for D-114's reason. Declaration language
  -- 14 is required to say `links`.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity', 'decimal', 'month', 'instant', 'links')),
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
  PRIMARY KEY (format_name, name)
);

INSERT INTO format_column_new
  (format_name, name, type, unit, per, required, is_unique, scale, minimum, maximum, target, note, position)
SELECT format_name, name, type, unit, per, required, is_unique, scale, minimum, maximum, target, note, position
  FROM format_column;

DROP TABLE format_column;

ALTER TABLE format_column_new RENAME TO format_column;
