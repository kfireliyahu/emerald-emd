-- 039_scale_and_time — a figure kept to fixed places, a month, a moment, and a
-- ratio as a dimension.
-- See docs/04-data-model.md ("Formats"), D-257 and M24 U6.
--
-- Numbered and immutable after release (D-020).
--
-- The ledger keeps `quantity_micro`, `price_micro`, `rate_micro` and basis
-- points as integers with the scale in their names, periods as `YYYY-MM` text
-- and moments as epoch integers — each a convention the next reader had to
-- know. The engine could say none of them: its only fraction was REAL, the
-- float the money rule forbids beside every amount these are multiplied by.

-- 1 -------------------------------------------------------------------------
-- Three more types, and the places a `decimal` keeps. SQLite cannot alter a
-- CHECK in place, so `format_column` is rebuilt and copied — the dance 035 and
-- 036 did before it. Every existing row keeps its own values and takes NULL
-- for `scale`, which is what it is for every column that is not a decimal.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Twelve now, and still closed for D-114's reason. `decimal` is an INTEGER
  -- figure times ten to its scale; `month` is `YYYY-MM`; `instant` is a moment
  -- in UTC to the millisecond. Declaration language 6 is required to say any
  -- of them.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity', 'decimal', 'month', 'instant')),
  unit        TEXT,
  per         TEXT,
  required    INTEGER NOT NULL CHECK (required IN (0, 1)),
  is_unique   INTEGER NOT NULL DEFAULT 0 CHECK (is_unique IN (0, 1)),
  -- How many places a `decimal` keeps, and NULL for every other type. One to
  -- nine: zero is an integer, and past nine the stored figure stops being a
  -- whole number JavaScript holds exactly.
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
SELECT format_name, name, type, unit, per, required, is_unique, NULL, minimum, maximum, target, note, position
  FROM format_column;

DROP TABLE format_column;

ALTER TABLE format_column_new RENAME TO format_column;

-- 2 -------------------------------------------------------------------------
-- RATIO, the seventh dimension: a fee in basis points is a unit, not a spelling
-- in a column's name. Its base is the percent, so `bp` is 0.01 of one.
--
-- **No conversion from a ratio into money is added, and none can be** (D-223):
-- a dimension converts only inside itself, and a `money` column carries no
-- unit at all.
--
-- Rebuilt for the same reason as above — the CHECK names the dimensions — and
-- every row is copied as it is, a person's own units included.

CREATE TABLE measurement_unit_new (
  symbol     TEXT PRIMARY KEY NOT NULL,
  dimension  TEXT NOT NULL CHECK (dimension IN (
               'MASS', 'VOLUME', 'LENGTH', 'TIME', 'ENERGY', 'COUNT', 'RATIO')),
  per_base   REAL NOT NULL CHECK (per_base > 0),
  origin     TEXT NOT NULL CHECK (origin IN ('SEEDED', 'USER')),
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO measurement_unit_new (symbol, dimension, per_base, origin, note, created_at)
SELECT symbol, dimension, per_base, origin, note, created_at FROM measurement_unit;

DROP TABLE measurement_unit;

ALTER TABLE measurement_unit_new RENAME TO measurement_unit;

-- `OR IGNORE`: a person who already added a `%` of their own keeps it.
INSERT OR IGNORE INTO measurement_unit (symbol, dimension, per_base, origin, note) VALUES
  ('%',  'RATIO', 1,    'SEEDED', 'Parts per hundred. The base of the dimension.'),
  ('bp', 'RATIO', 0.01, 'SEEDED', 'A basis point, a hundredth of a percent.');
