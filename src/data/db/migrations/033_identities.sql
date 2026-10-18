-- 033_identities — what has to add up about one of these.
-- See docs/04-data-model.md ("Formats"), docs/engine.md (H3) and D-222.
--
-- Numbered and immutable after release (D-020).
--
-- **032 said its three tables were the last hand-written ones the engine
-- needs, and this is the fourth.** A past migration is never edited, so the
-- sentence stands where it was written and this is where it is corrected: what
-- 032 meant, and what is still true, is that every table holding *rows a person
-- declared* is made by the reconciler rather than by a file in this folder. The
-- declarations themselves live in hand-written tables, and an identity is part
-- of a declaration.
--
-- **Nothing here becomes SQL.** A `CHECK` says what cannot be stored; an
-- identity says what should add up. The first refuses the row and the second
-- reports on it — and a label whose macros come to 61.6 against a printed 62 is
-- a real label, so refusing it would lose the reading that proves the point.
-- The expression is parsed and evaluated by the engine, in TypeScript, over
-- numbers; it never reaches `db.run` as anything but a value, and D-216's
-- refusal of a free-text `CHECK` is untouched.

-- 1 -------------------------------------------------------------------------
-- H3, answered *prompted* on 2026-09-07 and built here: a format with nothing
-- that must hold is allowed, and only said out loud. The editor refuses to
-- finish quietly, and so does `declare_format` — a conversation is exactly
-- where the question is worth asking.

ALTER TABLE format ADD COLUMN nothing_must_hold INTEGER NOT NULL DEFAULT 0;

-- 2 -------------------------------------------------------------------------
-- One identity: an equation over this format's own numeric columns, and how
-- far apart the two sides may be.

CREATE TABLE format_identity (
  format_name     TEXT NOT NULL REFERENCES format (name),
  -- `snake_case`, unique within the format, and what a verdict is reported by.
  name            TEXT NOT NULL,
  -- `4*protein_g + 4*carbs_g + 9*fat_g + 2*fiber_g = kcal`, **exactly as the
  -- author typed it**. Never rewritten into a canonical form: the artefact
  -- exists so two versions of a format can be diffed by a person, and a
  -- normalizer would make every diff a diff of this build's opinions.
  expression      TEXT NOT NULL,
  -- ABSOLUTE is `|left - right| <= amount`, where zero is exact and is what
  -- money wants. RELATIVE is a percentage of the right-hand side, which is what
  -- a rounded label wants — a printed 62 kcal is the sum to within about 2%.
  tolerance_kind  TEXT NOT NULL CHECK (tolerance_kind IN ('ABSOLUTE', 'RELATIVE')),
  tolerance_amount REAL NOT NULL DEFAULT 0,
  -- Why this has to hold, in the author's words. Prose, stored, never parsed.
  note            TEXT NOT NULL DEFAULT '',
  -- The order they are declared in, which is the order a person reads them.
  position        INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);
