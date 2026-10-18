-- 036_quantities — a figure may carry its own unit, and a column may hold the
-- fact that crosses a dimension.
-- See docs/04-data-model.md ("Formats"), docs/engine.md (H7) and D-225.
--
-- Numbered and immutable after release (D-020).
--
-- **This is U4a and U4b meeting**, and it is the last thing the recipe case
-- wants. U4a decided that the engine owns dimension and conversion and that a
-- factor crossing a dimension is a column somebody declared (D-223); U4b gave
-- an expression one hop through a link (D-224). A recipe line is `150 g` on one
-- row and `200 ml` on the next, and turning the second into grams needs a
-- density — which is a fact about *pasta*, on the far side of the link, in a
-- column the vault (D-210) already keeps by hand.
--
-- Two things arrive together because neither is worth much alone:
--
--   * `quantity`, a figure and the unit it is in, **per row**;
--   * `per`, the other half of a ratio column, so `density` is `g` per `ml`
--     rather than a number whose meaning is in its spelling.
--
-- **The engine still knows no density.** `convertAcross` performs arithmetic on
-- a fact it was handed and refuses every crossing it was not — which is H7's
-- line held, a unit later, with a way through it.

-- 1 -------------------------------------------------------------------------
-- The ninth type and the second half of a ratio, which means rebuilding
-- `format_column` again.
--
-- SQLite cannot alter a CHECK in place, so the table is recreated and copied —
-- the same dance 030 did for price precision and 035 for the link type.
-- **Nothing here is derived or guessed**: every existing row keeps its own
-- values and takes NULL for the column that did not exist when it was written,
-- which is what `per` is for every column that is not a ratio.

CREATE TABLE format_column_new (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Nine now. `quantity` is the second type that is not one column: it stores a
  -- REAL figure beside a TEXT symbol, for the same reason `money` stores minor
  -- units beside a currency code. A `real` with the unit kept in a `text`
  -- column beside it is this type built by hand, one format at a time, with
  -- nothing checking that the symbol is a unit the document knows.
  --
  -- Still closed, and still for D-114's reason: the list is handed to a model
  -- as an enum, and a model asked to use an app's vocabulary unaided invents
  -- members of it.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money',
                'link', 'quantity')),
  -- What the figure is *in* — g, mg, kcal, µg, ml. Interpreted since U4a
  -- (D-223). NULL on a `quantity`, whose unit is in the row, and on a `money`,
  -- whose currency is.
  unit        TEXT,
  -- The other half of a ratio: **this column is `unit` per `per`** (U4c,
  -- D-225). A density is `g` per `ml`; what one egg weighs is `g` per `each`.
  --
  -- It is the one thing `unit.ts` refuses to know, written down by the person
  -- who knows it, about the thing it is a fact about. NULL for every column
  -- that is not a ratio, which is almost all of them.
  --
  -- **Changing it is as dangerous as changing a unit and is refused the same
  -- way** (D-214): a density that was `g` per `ml` and is now `g` per `l`
  -- alters no SQL, loses no row, and makes every figure bridged through it
  -- wrong by a thousand.
  per         TEXT,
  required    INTEGER NOT NULL CHECK (required IN (0, 1)),
  minimum     REAL,
  maximum     REAL,
  -- The format a `link` points at, and NULL for every other type. See 035.
  target      TEXT,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);

INSERT INTO format_column_new
  (format_name, name, type, unit, per, required, minimum, maximum, target, note, position)
SELECT format_name, name, type, unit, NULL, required, minimum, maximum, target, note, position
  FROM format_column;

DROP TABLE format_column;

ALTER TABLE format_column_new RENAME TO format_column;
