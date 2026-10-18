-- 062_file — a column may point at a file on this computer.
-- See docs/04-data-model.md ("Formats") and M37 U6.
--
-- Numbered and immutable after release (D-020).
--
-- `file` is the eighteenth type: where a file is — a path, relative to the
-- document's folder when it is under it, or a local app's own address — and
-- never what is in it. It is a cell of the declared table like any text, so
-- this migration only lets `format_column` say the word.

-- SQLite cannot alter a CHECK in place, so `format_column` is rebuilt and
-- copied — 061's dance, every row as it is.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Eighteen now, and still closed for D-114's reason. Declaration language
  -- 24 is required to say `file`.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity', 'decimal', 'month', 'instant', 'links',
                'percent', 'time', 'enums', 'elsewhere', 'file')),
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
