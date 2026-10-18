-- 054_percent — a percent column.
-- See docs/04-data-model.md ("Formats"), D-333 and M29 U3.
--
-- Numbered and immutable after release (D-020).
--
-- `percent` is the fourteenth type: a share, entered and shown as `12.5%` and
-- stored in the declared table as an INTEGER of millionths of the whole —
-- `125000` — so it is exact and SQL integer arithmetic can multiply money by
-- it. The declared table is the reconciler's; this migration only lets
-- `format_column` say the word.
--
-- SQLite cannot alter a CHECK in place, so `format_column` is rebuilt and
-- copied — the dance 035, 036, 039 and 053 did before it. Every row is copied
-- as it is.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Fourteen now, and still closed for D-114's reason. Declaration language
  -- 15 is required to say `percent`.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity', 'decimal', 'month', 'instant', 'links',
                'percent')),
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
