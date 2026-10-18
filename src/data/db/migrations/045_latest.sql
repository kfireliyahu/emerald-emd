-- 045_latest — an aggregate that picks the latest (or earliest) row by an order.
-- See docs/04-data-model.md ("Formats"), D-267, D-272 and M25 E3.
--
-- Numbered and immutable after release (D-020).
--
-- `price: latest price of security_price.security by as_of` — over the rows
-- that point here, the one with the greatest as_of, and its price. The kind's
-- CHECK named five folds, and SQLite cannot change a CHECK in place, so the
-- table is rebuilt: the same columns, two more kinds, and the order column.

CREATE TABLE format_aggregate_new (
  format_name  TEXT NOT NULL REFERENCES format (name),
  name         TEXT NOT NULL,
  -- The five folds, and the two that pick one row by `by_column`.
  kind         TEXT NOT NULL CHECK (kind IN (
                 'SUM', 'COUNT', 'AVERAGE', 'MINIMUM', 'MAXIMUM', 'LATEST', 'EARLIEST')),
  over_format  TEXT NOT NULL,
  over_column  TEXT NOT NULL,
  expression   TEXT NOT NULL DEFAULT '',
  unit         TEXT,
  note         TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL,
  where_column TEXT,
  where_member TEXT,
  -- A column of the source's own row — a date, month, instant or integer —
  -- that LATEST and EARLIEST pick by. Empty for every other kind, and required
  -- for those two; the declaration says so before a row is ever written here.
  by_column    TEXT,
  PRIMARY KEY (format_name, name)
);

INSERT INTO format_aggregate_new (
  format_name, name, kind, over_format, over_column, expression, unit, note, position,
  where_column, where_member
)
SELECT format_name, name, kind, over_format, over_column, expression, unit, note, position,
       where_column, where_member
  FROM format_aggregate;

DROP TABLE format_aggregate;
ALTER TABLE format_aggregate_new RENAME TO format_aggregate;
