-- 004_printed_total — the figure the statement prints for itself.
--
-- Numbered and immutable after release. See D-020 and docs/02-architecture.md.
--
-- docs/f01 ("Verification") wants the review screen to show the file's own
-- total next to the parsed one, because with a user-defined mapping a wrong
-- mapping is the main risk and this is the cheapest signal of one.
--
-- On the session rather than recomputed on the review screen, because by then
-- the sheet is gone: a resumed import has staged rows in the document and no
-- file in memory, and a verification figure that vanishes when you close the
-- tab is not one you can rely on.
--
-- Nullable throughout: plenty of files state no total at all, and "the file did
-- not say" is a different fact from "the file said zero".

ALTER TABLE import_session ADD COLUMN printed_total_minor INTEGER;
ALTER TABLE import_session ADD COLUMN printed_total_currency TEXT;
-- The text it was read out of, kept verbatim. The comparison is a claim about
-- the file, and the user has to be able to check it against the file.
ALTER TABLE import_session ADD COLUMN printed_total_text TEXT;
ALTER TABLE import_session ADD COLUMN printed_total_source TEXT;
