-- 009_staged_row_suggested_rule — which rule made the suggestion the user is
-- looking at.
--
-- Numbered and immutable after release (D-020). See docs/f03-auto-categorization-engine.md
-- and D-038.
--
-- `suggested_category_id` has been on `staged_row` since 003 and nothing wrote
-- it. Now that the engine does, the row has to remember *which* rule decided:
-- the commit writes `transaction.matched_rule_id`, and re-running the engine at
-- commit time would be a second answer to a question already answered — the
-- rule set can change between staging a file and committing it, and the
-- category that lands must be the one the user reviewed.

ALTER TABLE staged_row ADD COLUMN suggested_rule_id TEXT;
