-- 050_graph_place — where a bubble sits on the connections canvas.
-- See docs/04-data-model.md ("Formats"), D-291 and M26 U4.
--
-- Numbered and immutable after release (D-020).
--
-- **Presentation, so never the declaration**, for 049's reason: a position says
-- nothing about what a format holds, and a declaration that carried one would
-- change every time somebody moved a bubble. Kept per document, not in the
-- browser (D-115).
--
-- A place is a format's bubble or a pack's folded group (D-269), which is why
-- it is keyed by kind and name rather than by a foreign key to format: a pack
-- is not a row anywhere. deleteFormat clears a format's place, and the text
-- form drops a place nothing answers to.

CREATE TABLE format_graph_place (
  kind TEXT NOT NULL CHECK (kind IN ('FORMAT', 'PACK')),
  name TEXT NOT NULL,
  -- CSS pixels on the canvas before zoom; bounded so a hand-edited file cannot
  -- throw a bubble somewhere no pan reaches.
  x    INTEGER NOT NULL CHECK (x BETWEEN -100000 AND 100000),
  y    INTEGER NOT NULL CHECK (y BETWEEN -100000 AND 100000),
  PRIMARY KEY (kind, name)
);
