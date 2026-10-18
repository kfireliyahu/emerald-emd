-- 042_intake_header — a reading writes its own header row.
-- See docs/04-data-model.md ("Formats"), D-262 and M24 U10.
--
-- Numbered and immutable after release (D-020).
--
-- A statement is one header — a printed total, a billing period, a card — and
-- many lines. Intake read the lines and dropped the header on the floor, which
-- is why checking a statement against its own printed total was pack code. So
-- a reading may also write ONE row of a second format, from values fixed for
-- the file and from cells outside the table, and link every line to it. The
-- check is then the header format's own aggregate and identity (D-252).

-- 1 -------------------------------------------------------------------------
-- Which format the header row is, and which link of the lines points at it.
-- Both empty is a reading with no header, which is every reading before this.
ALTER TABLE format_intake ADD COLUMN header_format TEXT;
ALTER TABLE format_intake ADD COLUMN header_link TEXT;

-- 2 -------------------------------------------------------------------------
-- The header row is a row this file wrote, so superseding takes it back with
-- the lines. **It is in another table**, so the record says which: empty is
-- the intake's own format, which is every row before this.
ALTER TABLE format_intake_row ADD COLUMN format_name TEXT;

-- 3 -------------------------------------------------------------------------
-- The header's bindings: a key filled by one cell of the file — **a position,
-- never a value** (D-137): a model answers with where the total is and code
-- reads it — or by one value fixed for the file.
--
-- `source_row` below zero counts from the file's last row that holds
-- anything: a printed total sits under the lines, so its row moves with every
-- statement and its distance from the end does not.
CREATE TABLE format_intake_header_cell (
  intake_id    TEXT NOT NULL REFERENCES format_intake (id),
  key_name     TEXT NOT NULL,
  source_row   INTEGER,
  source_index INTEGER,
  fixed_value  TEXT,
  PRIMARY KEY (intake_id, key_name),
  CHECK ((source_row IS NULL) = (source_index IS NULL)),
  CHECK ((source_index IS NULL) <> (fixed_value IS NULL))
);
