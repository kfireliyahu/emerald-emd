-- 041_aggregate_filter — an aggregate over only the rows that match.
-- See docs/04-data-model.md ("Formats"), D-260 and M24 U8.
--
-- Numbered and immutable after release (D-020).
--
-- A payslip's net is its gross less the lines whose deduction type reduces
-- net, not less every line. So an aggregate may name one enum or boolean
-- column of the rows it folds — or one hop through their link — and the one
-- member it has to be: `deduction_type.reduces_net is true`. Both empty is an
-- aggregate over every row that points here, which is every aggregate before
-- this migration.
--
-- Two columns and not a sentence, because the column and the member are all a
-- filter is: there is no `or` and no list to write down (D-260).

ALTER TABLE format_aggregate ADD COLUMN where_column TEXT;
-- The member exactly as declared, or `true` / `false` for a boolean.
ALTER TABLE format_aggregate ADD COLUMN where_member TEXT;
