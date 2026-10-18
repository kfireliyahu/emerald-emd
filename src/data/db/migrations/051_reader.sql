-- 051_reader — a reader keeps its column order, can be named, and can be forgotten.
-- See docs/04-data-model.md ("Formats"), D-293 and M26 F1.
--
-- Numbered and immutable after release (D-020).
--
-- A reader is a format's accepted readings grouped by header (D-292), and the
-- header was kept only as a sorted signature — so a file whose columns were
-- reordered had the same one, fitted, and read every column by its old
-- position. Wrong, and silent.

-- 1 -------------------------------------------------------------------------
-- The header as the file had it: a JSON array of normalized header cells, one
-- per column, '' where a cell is empty. What lets a moved column be followed by
-- its name. Empty for a reading made before this, which cannot tell.
ALTER TABLE format_intake ADD COLUMN header_cells TEXT;

-- 2 -------------------------------------------------------------------------
-- Forgetting a reader is not taking back what it wrote. The rows stay, the
-- record of which rows they are stays (so supersede still can), and the
-- reading stops being offered. A reading accepted later for the same header is
-- a new reader.
ALTER TABLE format_intake ADD COLUMN forgotten INTEGER NOT NULL DEFAULT 0 CHECK (forgotten IN (0, 1));

-- 3 -------------------------------------------------------------------------
-- The name a person gave a reader, by the header it was made for. Without one
-- a reader is named by the file it last read. No FOREIGN KEY, for 035's reason;
-- deleteFormat and forgetting a reader clear it.
CREATE TABLE format_reader (
  format_name TEXT NOT NULL,
  signature   TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  PRIMARY KEY (format_name, signature)
);
