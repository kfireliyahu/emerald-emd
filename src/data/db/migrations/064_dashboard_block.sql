-- 064_dashboard_block — a dashboard's blocks, in order.
-- See docs/04-data-model.md ("FormatDashboardBlock"), D-514, D-521 and M53 U7.
--
-- Numbered and immutable after release (D-020).
--
-- **Presentation, so never the declaration**, as every view is (D-289): a
-- dashboard says which views to look at together, never what a row holds.
--
-- A row per block: the dashboard it is on (a format's name, or NULL for the
-- document's own), its place, the format it reads, and what it is — a saved
-- view or a rollup by name, or a headline total, whose column summed (NULL is a
-- count) and filter (the address's spelling, as a saved view keeps one) live
-- only here. Nothing else can be a block (D-514): no free text, no embed.
--
-- **Not more rows of format_view_column** (052), for the reason 063 gave: a
-- setting there is one word of at most 32 characters for one column.
--
-- No foreign key to a saved view or a rollup: a block naming one that has gone
-- is drawn as gone, with the sentence, and can be removed. deleteFormat clears
-- the blocks on its dashboard and the blocks that read it.

CREATE TABLE format_dashboard_block (
  dashboard   TEXT REFERENCES format (name),
  position    INTEGER NOT NULL CHECK (position >= 0),
  format_name TEXT NOT NULL REFERENCES format (name),
  kind        TEXT NOT NULL CHECK (kind IN ('saved', 'rollup', 'total')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  sum         TEXT CHECK (sum IS NULL OR kind = 'total'),
  address     TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 2000 AND (address = '' OR kind = 'total'))
);

-- One block per thing on a dashboard; the document's is the one with no format.
CREATE UNIQUE INDEX format_dashboard_block_one ON format_dashboard_block (ifnull(dashboard, ''), format_name, name);
