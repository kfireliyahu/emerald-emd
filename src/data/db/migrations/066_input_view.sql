-- 066_input_view — a saved view that asks for rows, and the format's default one.
-- See docs/04-data-model.md ("FormatSavedView"), D-533, D-536 and M55 U2.
--
-- Numbered and immutable after release (D-020).
--
-- **An input view is a saved view of kind `input`** (D-533): its address's
-- columns are the fields it asks, in order, and its exact values its defaults.
-- No table of its own: it is kept, renamed, deleted and written into a text
-- document exactly as every other saved view is.
--
-- **`is_default` marks the format's default input view** — the one Add, the
-- list's + and quick add open, and whose defaults a new row starts from. A
-- column and a partial unique index rather than a setting elsewhere: the mark
-- belongs to the view, follows it through a rename and goes with it on a
-- delete, and the index is what holds it to one per format. Only an input
-- view takes it (the CHECK).
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt; nothing
-- points at it by key (a dashboard block names a view by its format and name).

CREATE TABLE format_saved_view_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind        TEXT NOT NULL CHECK (kind IN ('table', 'board', 'list', 'roadmap', 'ready', 'input')),
  address     TEXT NOT NULL CHECK (length(address) <= 2000),
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1) AND (is_default = 0 OR kind = 'input')),
  PRIMARY KEY (format_name, name)
);

INSERT INTO format_saved_view_new (format_name, name, kind, address)
  SELECT format_name, name, kind, address FROM format_saved_view;

DROP TABLE format_saved_view;

ALTER TABLE format_saved_view_new RENAME TO format_saved_view;

CREATE UNIQUE INDEX format_saved_view_default ON format_saved_view (format_name) WHERE is_default = 1;
