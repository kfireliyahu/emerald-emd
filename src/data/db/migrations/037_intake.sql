-- 037_intake — a document read onto a declared format, and the record of what
-- that reading wrote.
-- See docs/04-data-model.md ("Formats"), docs/07-roadmap.md (M19 U5) and D-226.
--
-- Numbered and immutable after release (D-020).
--
-- **This is the third arrow arriving at the other two.** U1 to U4c built a
-- format that compiles, proves itself and reaches across a link, and every row
-- in one so far arrived one at a time — from a conversation, or from a form. A
-- person with four hundred lines in a spreadsheet had no way in at all.
--
-- Nothing here is a second importer. The reading is a mapping from a file's
-- columns to the keys a conversation already offers `record_format_rows`, so a
-- sheet and a tool call meet in the same `coerceRow` and this build has one
-- answer to *what is that value* (D-013, D-138).

-- 1 -------------------------------------------------------------------------
-- The file that was read, the reading that read it, and when.
--
-- **An intake is only ever written after a person committed one**, which is
-- what makes this table double as the ladder's memory: every reading in it is
-- one somebody looked at and accepted, so rung 1 needs no `confirmed` flag of
-- the kind `import_mapping` carries. A reading that was abandoned on the
-- confirm surface leaves nothing behind, because nothing about it was true.
--
-- **The signature is kept as text rather than hashed** (D-139, one level up): a
-- hash answers *same or not*, and what rung 1 needs is *how close* — a provider
-- that renamed one column of nine has not sent a different document, and the
-- surface should say which column moved rather than start from nothing.

CREATE TABLE format_intake (
  id          TEXT PRIMARY KEY,
  -- No FOREIGN KEY on purpose, for 035's reason: this app never runs
  -- `PRAGMA foreign_keys = ON` (D-067), so one would enforce nothing while
  -- making `deleteFormat` fail depending on a pragma nobody sets. The
  -- repository clears a format's intakes when it drops the table, and that is
  -- the rule that actually holds.
  format_name TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  -- What makes this *the same file* rather than a similar one. It is the only
  -- question about sameness this engine is willing to answer by itself: **what
  -- makes two rows the same row is a fact about the format**, which nobody has
  -- declared, and inventing one would be the density mistake H7 was opened to
  -- prevent (D-223) in a new place. So re-reading a file the document has
  -- already read offers to supersede what that file wrote, by name and count,
  -- and a person says yes — which is the non-negotiable pair honoured exactly:
  -- re-import supersedes, and nothing is auto-deleted.
  file_hash   TEXT NOT NULL,
  signature   TEXT NOT NULL,
  header_row  INTEGER NOT NULL,
  date_order  TEXT NOT NULL CHECK (date_order IN ('dmy', 'mdy', 'ymd')),
  read_at     INTEGER NOT NULL,
  -- **Nothing once superseding has run**, and the row stays. Removing the rows a
  -- file wrote and forgetting how to read that file are two different acts, and
  -- the ordinary flow is to do the first and then immediately want the second
  -- not to have happened: supersede, correct the file, read it again. So the
  -- rows go, `format_intake_row` goes, and the reading is still here.
  row_count   INTEGER NOT NULL
);

CREATE INDEX format_intake_by_format ON format_intake (format_name, read_at DESC);
CREATE INDEX format_intake_by_hash ON format_intake (format_name, file_hash);

-- 2 -------------------------------------------------------------------------
-- The reading itself: one row per key that gets filled.
--
-- **A key and not a column**, which is what lets `money` and `quantity` through
-- with no special case: `paid` comes from column 3 and `paid_currency` is `ILS`
-- for the whole file, and those are two rows here that differ in which of the
-- two sources they use.
--
-- The `CHECK` is the whole grammar of a binding: a key is filled by a column of
-- the file **or** by one value for every row, never both and never neither. A
-- row that said neither would be a mapping that maps nothing, stored.
--
-- `fixed_value` is also where a **link** is answered, and it is the only place
-- one can be. A person picks the recipe once and four hundred lines point at
-- it; a column of a file may not fill a link at all, because matching a name a
-- retailer wrote to a row of this document is H10 and H10 is open. See
-- `reading.ts`, which refuses it by name rather than by having no select.

CREATE TABLE format_intake_column (
  intake_id    TEXT NOT NULL REFERENCES format_intake (id),
  key_name     TEXT NOT NULL,
  source_index INTEGER,
  fixed_value  TEXT,
  PRIMARY KEY (intake_id, key_name),
  CHECK ((source_index IS NULL) <> (fixed_value IS NULL))
);

-- 3 -------------------------------------------------------------------------
-- Which rows this reading wrote.
--
-- **The rows are in the user's own table and carry nothing about where they
-- came from**, which is not an omission: a declared table has exactly the
-- columns somebody declared, and an engine that quietly added a
-- `_came_from_file` column to it would be the untyped storage D-209 refused,
-- arriving through the back. Provenance is a fact about the *import*, so it is
-- kept beside the import.
--
-- It is what makes superseding possible at all, and it is also the honest
-- answer to *what did reading this file actually do to my document*.

CREATE TABLE format_intake_row (
  intake_id TEXT NOT NULL REFERENCES format_intake (id),
  row_id    TEXT NOT NULL,
  PRIMARY KEY (intake_id, row_id)
);

CREATE INDEX format_intake_row_by_row ON format_intake_row (row_id);
