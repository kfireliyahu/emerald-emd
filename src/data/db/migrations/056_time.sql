-- 056_time — a time-of-day column.
-- See docs/04-data-model.md ("Formats"), D-335 and M29 U4.
--
-- Numbered and immutable after release (D-020).
--
-- `time` is the fifteenth type: a time of day, stored in the declared table as
-- `HH:MM` text in twenty-four hours, so it sorts as it reads. With `date` and
-- `instant` it is a point, and the one arithmetic a point takes is `end -
-- start`, a span in hours (two times wrap at midnight) or days. The declared
-- table is the reconciler's; this migration only lets `format_column` say the
-- word.
--
-- SQLite cannot alter a CHECK in place, so `format_column` is rebuilt and
-- copied — the dance 035, 036, 039, 053 and 054 did before it. Every row is
-- copied as it is.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Fifteen now, and still closed for D-114's reason. Declaration language
  -- 17 is required to say `time`.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity', 'decimal', 'month', 'instant', 'links',
                'percent', 'time')),
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
