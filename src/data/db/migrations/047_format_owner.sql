-- 047_format_owner — which pack owns a format, and where its rows are written.
-- See docs/04-data-model.md ("Formats"), D-269 and M25 E5.
--
-- Numbered and immutable after release (D-020).
--
-- Kept in the document rather than derived from the pack's code: the
-- engine-only server never loads that code, and it is exactly the surface that
-- has to refuse a generic write to the pack's rows. NULL for a format a person
-- declared, which is every format but a pack's.

-- The pack's name: `ledger`.
ALTER TABLE format ADD COLUMN pack TEXT;
-- Where the rows are written instead, as the pack says it: `on the Categories
-- screen, or with create_category`. The tail of every refusal.
ALTER TABLE format ADD COLUMN pack_written TEXT;
-- The columns the pack declared, comma-separated. A column not named here is a
-- person's own, and may be changed or dropped like any of theirs.
ALTER TABLE format ADD COLUMN pack_columns TEXT;
