-- 063_saved_view — a format's filter, order, columns and kind under a name.
-- See docs/04-data-model.md ("FormatSavedView"), D-514, D-520 and M53 U5.
--
-- Numbered and immutable after release (D-020).
--
-- **Presentation, so never the declaration**, as every view is (D-289): a
-- saved view says how to look at the rows, never what a row holds.
--
-- **Not more rows of format_view_column** (052): a setting there is one word
-- of at most 32 characters for one column, and a saved view is a sentence
-- about the whole format — its address, `?due=today&state!=done`, held as the
-- address spells it, so a window around today stays the phrase.
--
-- No foreign key to format_column: an address naming a column that has gone
-- is drawn with every row and a sentence saying why, as an old bookmark is.
-- deleteFormat clears a format's rows here.

CREATE TABLE format_saved_view (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind        TEXT NOT NULL CHECK (kind IN ('table', 'board', 'list', 'roadmap', 'ready')),
  address     TEXT NOT NULL CHECK (length(address) <= 2000),
  PRIMARY KEY (format_name, name)
);
