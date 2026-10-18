-- 058_found_by — a link that says how it is found.
-- See docs/04-data-model.md ("Formats"), D-350 and M29 F8.
--
-- Numbered and immutable after release (D-020).
--
-- `date in period` (the same month) or `date on paid_on` (the same day): this
-- row's date column and the target's date or month column it falls in. Empty
-- for every column that is not a link found by a date. The engine reads it on
-- a write and stores the link it finds, so nothing here is a search on read.
-- Declaration language 18 is required to declare one.

ALTER TABLE format_column ADD COLUMN found_by TEXT;
