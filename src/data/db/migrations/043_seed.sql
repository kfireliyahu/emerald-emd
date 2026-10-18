-- 043_seed — a pack's seeded rows.
-- See docs/04-data-model.md ("Formats"), D-264 and M24 U12.
--
-- Numbered and immutable after release (D-020).
--
-- A pack is more than declarations: the ledger ships a category tree, the
-- deduction types, institutions, its built-in rules. Units already carry the
-- answer (origin SEEDED or USER, D-223) so a later build may correct its own
-- rows and never a person's. A declared table may not carry that column — it
-- holds what a document says and nothing the engine keeps about it (D-209) —
-- so this is the record beside it, as `format_intake_row` is.
--
-- **Keyed by the row's name, not its id.** A seeded format names its rows by a
-- unique column (D-255), and a text document mints its ids from content
-- (D-247): an id changes when the row does and when the text is read back, and
-- the name is what the pack's own file calls the row.
--
-- A row is the pack's while its record says SEEDED. A person's edit deletes the
-- record, so the row is theirs and the pack never writes it again. A person's
-- delete leaves REMOVED behind, so a reseed does not bring it back.
CREATE TABLE format_seed (
  format_name TEXT NOT NULL,
  seed_key    TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('SEEDED', 'REMOVED')),
  PRIMARY KEY (format_name, seed_key)
);
