-- 060_source_key — a row a reading wrote remembers the line it came from.
-- See docs/04-data-model.md ("Formats"), D-408 and M38 U3.
--
-- Numbered and immutable after release (D-020).
--
-- Both trials of M34 ended on the same verdict: a read is a copy that drifts
-- from its source within a week, and the only way back was to supersede the
-- whole file and read it again. A second read of the same source now updates
-- the rows the first wrote, adds what is new and names what is gone — and for
-- that a row has to say which line of its source it is. **Beside the row and
-- never in it**, for 037's reason: a declared table holds what somebody
-- declared, and the provenance of a row is a fact about the read.

-- 1 -------------------------------------------------------------------------
-- The line's key: a note's file name, or the value of the format's unique
-- column the reading fills (its name, when the name is unique). Empty for a
-- row whose read had no key, which is every row before this — such a read is
-- read again exactly as before, adding to what it wrote.
ALTER TABLE format_intake_row ADD COLUMN source_key TEXT;

-- 2 -------------------------------------------------------------------------
-- What the read wrote into the row, as a mark over its cells. A row whose
-- cells no longer match the mark was changed by a person since, and a later
-- read leaves it as it is and says so: a manual value is never overwritten by
-- a re-import. A link is left out of the mark, because a text document mints
-- its rows' ids afresh on every open (D-247) and a link holds one.
ALTER TABLE format_intake_row ADD COLUMN written TEXT;

-- 3 -------------------------------------------------------------------------
-- A source is found again by its file name, not its bytes: a corrected export
-- has a new hash and is the same source.
CREATE INDEX format_intake_by_file ON format_intake (format_name, file_name);
