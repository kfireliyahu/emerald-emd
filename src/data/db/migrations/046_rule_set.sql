-- 046_rule_set — a format's rows as rules that set a link of another format.
-- See docs/04-data-model.md ("Formats"), D-267, D-273 and M25 E4.
--
-- Numbered and immutable after release (D-020).
--
-- A rule set is applied by the engine on a write of the format it sets and on
-- demand, and what it decides is stored in that format's own columns: this
-- table is the declaration and nothing else, as format_rollup is.

CREATE TABLE format_rule_set (
  -- The format whose rows are the rules: `category_rule`.
  format_name TEXT NOT NULL REFERENCES format (name),
  -- What it is asked for by: `categories`. Unique within the format.
  name        TEXT NOT NULL,
  -- The rule set as its one sentence — `transaction.category from target when
  -- merchant_normalized matches pattern as contains first by priority,
  -- recorded in category_source as RULE, never over MANUAL` — stored as the
  -- artefact writes it and parsed on read, as a rollup is.
  sets        TEXT NOT NULL,
  -- Why it is worth declaring, in the author's words. Prose, never parsed.
  note        TEXT NOT NULL DEFAULT '',
  -- The order they are declared in.
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);
