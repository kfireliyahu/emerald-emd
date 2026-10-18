-- 057_document_setting — what a document says about itself, beside its formats.
-- See docs/04-data-model.md ("Cross-cutting"), D-344 and M29 F3.
--
-- Numbered and immutable after release (D-020).
--
-- One key so far: `currency`, the currency a new money figure is in until a
-- row says otherwise — chosen the first time a money column is made, and
-- changed from any money column's panel or with `record_units`. It is the
-- document's and not the machine's (D-115): two documents kept in two
-- currencies each open in their own.
--
-- A key and a text value rather than a column per setting, for D-034's reason:
-- a second setting is a row, not a migration. What a key's value may be is
-- checked here where it can be, and the currency is three capital letters, as
-- every money column's currency is.

CREATE TABLE document_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  CHECK (key <> 'currency' OR (length(value) = 3 AND value GLOB '[A-Z][A-Z][A-Z]'))
);
