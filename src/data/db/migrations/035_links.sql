-- 035_links — a column may point at a row of another format, and a format may
-- work something out from the rows that point at it.
-- See docs/04-data-model.md ("Formats"), docs/engine.md (the line) and D-224.
--
-- Numbered and immutable after release (D-020).
--
-- **This is the clause D-210 moved the engine's line to permit**, and it is the
-- only one that was still missing:
--
--   > Declarable: identities, links between entities, derived columns,
--   > **aggregates across a link with unit conversion**, threshold banding.
--
-- A recipe's kilocalories are the sum of its lines; a line's are an amount times
-- an ingredient's figure. The vault (D-210) does that by hand, in prose, from
-- figures kept on twelve other notes — which is the whole reason the line moved.
--
-- **One hop out and one hop back, and the syntax has no way to write a second.**
-- An expression may read a column of the row it names — `ingredient.kcal` — and
-- an aggregate folds the rows whose link column names this row. Neither is a
-- traversal, and a declaration language that could traverse would be the
-- programming language nobody will write in (D-209).

-- 1 -------------------------------------------------------------------------
-- The `link` type, which means rebuilding `format_column`.
--
-- SQLite cannot alter a CHECK in place, so the table is recreated and copied —
-- the same dance 030 did for price precision. **Nothing here is derived or
-- guessed**: every existing row keeps its own values and takes NULL for the
-- column that did not exist when it was written, which is what a link is for a
-- format that has none.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Eight now. `link` is the first type whose meaning is outside the row it is
  -- in, and it is still closed for D-114's reason: it is handed to a model as
  -- an enum, and a model asked to use an app's vocabulary unaided invents
  -- members of it.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money', 'link')),
  unit        TEXT,
  required    INTEGER NOT NULL CHECK (required IN (0, 1)),
  minimum     REAL,
  maximum     REAL,
  -- The format a `link` points at, and NULL for every other type. **A format
  -- name and not a table name**: a declaration names declarations, and the
  -- table is that name prefixed. A reader who had to know the prefix in order
  -- to read a declaration would be reading storage.
  --
  -- It may name the format it is on. A cooked label pointing at the dry one it
  -- was made from is one row of a format pointing at another row of the same
  -- format, and it is the case the roadmap has carried since U3.
  --
  -- **No FOREIGN KEY here on purpose.** It would point at `format.name`, which
  -- is right, and it would enforce nothing — this app never runs
  -- `PRAGMA foreign_keys = ON` (D-067) — while making `deleteFormat` fail in a
  -- way that depends on a pragma nobody sets. The refusal that actually holds
  -- is in the repository, and it names the format doing the pointing.
  target      TEXT,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);

INSERT INTO format_column_new
  (format_name, name, type, unit, required, minimum, maximum, target, note, position)
SELECT format_name, name, type, unit, required, minimum, maximum, NULL, note, position
  FROM format_column;

DROP TABLE format_column;

ALTER TABLE format_column_new RENAME TO format_column;

-- 2 -------------------------------------------------------------------------
-- What a format works out from the rows that point at it.
--
-- **Nothing here becomes SQL either**, which is now the third table in a row
-- that does not (032's declarations describe tables, 033's identities and this
-- are folded on read). An aggregate is computed every time it is read and never
-- stored, for the reason a verdict is (D-222): the vault's own failure was a
-- table of totals computed once by a model and frozen into prose while its
-- inputs moved underneath it (D-210). A total whose rows changed an hour ago is
-- a lie in a file, and the only defence that has ever worked here is not
-- writing it down.

CREATE TABLE format_aggregate (
  format_name TEXT NOT NULL REFERENCES format (name),
  -- `snake_case`, unique within the format, and what the figure is reported by.
  -- It may not be the name of a column of the same format: an identity can name
  -- either, and one word meaning two things is the silence this whole milestone
  -- is built to remove.
  name        TEXT NOT NULL,
  -- Five, closed, and each one a fold a person can check by hand. There is no
  -- MEDIAN, no DISTINCT and no FIRST — a fold that needs an order needs a
  -- traversal, and an aggregate that could sort would be the beginning of the
  -- query language D-095 refused at the tool surface and D-209 at this one.
  kind        TEXT NOT NULL CHECK (kind IN (
                'SUM', 'COUNT', 'AVERAGE', 'MINIMUM', 'MAXIMUM')),
  -- The rows folded: a format, and its `link` column that points back here.
  -- Both halves are checked when the declaration is made — a column pointing
  -- somewhere else would fold every row of the source into every row of this
  -- format, silently, and the figure would look entirely plausible.
  over_format TEXT NOT NULL,
  over_column TEXT NOT NULL,
  -- Evaluated on each row that points here, **in the source format's
  -- vocabulary** — its own columns, and one hop through its own links:
  -- `amount_g / 100 * ingredient.kcal`. Empty for COUNT, which asks about the
  -- rows rather than about a figure on them.
  --
  -- Stored exactly as it was typed and never normalized, for the reason an
  -- identity is: the artefact exists so two versions of a format can be diffed
  -- by a person, and a normalizer makes every diff a diff of this build's
  -- opinions.
  expression  TEXT NOT NULL DEFAULT '',
  -- What the result is in. Declared rather than derived, because the
  -- expression's own unit is a thing this engine deliberately will not always
  -- name (D-223) — and a figure reported with no unit beside one reported with
  -- a unit is how a factor of a thousand gets through. It is also what lets an
  -- identity convert the aggregate: `total_kcal in kJ`.
  unit        TEXT,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);
