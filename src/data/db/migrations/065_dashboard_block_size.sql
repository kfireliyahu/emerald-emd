-- 065_dashboard_block_size — a dashboard block's size, beside its place.
-- See docs/04-data-model.md ("FormatDashboardBlock"), D-527 and M53 F4.
--
-- Numbered and immutable after release (D-020).
--
-- A block is resized by dragging its edge, snapped to the grid: `width` in the
-- grid's columns (1 to 4) and `height` in its rows (2 to 20, a row 40 pixels
-- and the gap between two 16). NULL is the size the block had before it was
-- given one — a headline total one column, every other block two, and its
-- height its content's — so every block written before this keeps it.
--
-- Presentation, as the rest of the row is (D-289).

ALTER TABLE format_dashboard_block ADD COLUMN width INTEGER CHECK (width IS NULL OR width BETWEEN 1 AND 4);
ALTER TABLE format_dashboard_block ADD COLUMN height INTEGER CHECK (height IS NULL OR height BETWEEN 2 AND 20);
