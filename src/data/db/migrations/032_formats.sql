-- 032_formats — a format is declared, and the declaration lives in the document.
-- See docs/04-data-model.md ("Formats"), docs/engine.md and D-216.
--
-- Numbered and immutable after release (D-020).
--
-- **These three tables are the last hand-written ones the engine needs.** They
-- are the declarations; every table above them is made from a declaration by
-- the reconciler, not by a migration in this folder. That is D-214's unlock
-- said in SQL: `schema_version` keeps governing the built-in tables and nothing
-- else, and what has to be version-compatible across builds is the declaration
-- *language* — one integer, in `format.language` — rather than the set of
-- tables, which is unbounded.
--
-- **Nothing in the finance app references anything here and nothing here
-- references it.** The engine is built clean, beside the ledger, in the same
-- document, touching none of it (D-214). One document rather than two because
-- H2's own settling case needs it — a product you tried is worth recording
-- because its price links to the transaction that paid for it, and that
-- transaction is already in this file.
--
-- **Why three tables and not one with a JSON column.** The objection to
-- user-authored schemas is that they forfeit the constraints, and the answer is
-- that correctness never came from schemas being fixed, only from their being
-- real (D-209). A declaration stored as a blob would forfeit exactly what a
-- declared table is supposed to prove. `deduction_type` is the precedent and it
-- is exact (012, D-049): a real table whose rows the user creates.

-- 1 -------------------------------------------------------------------------
-- The format: a kind of thing.

CREATE TABLE format (
  -- `snake_case`, and what the table is named after — `ingredient` compiles to
  -- `fmt_ingredient`. The prefix is load-bearing rather than tidy: no built-in
  -- table carries it, so the reconciler can never reach one however wrong a
  -- declaration is. That guard is what lets this be built beside the app.
  name       TEXT PRIMARY KEY NOT NULL,
  -- What a person calls it. "Ingredient".
  title      TEXT NOT NULL,
  -- The declaration language this was written in. A document authored by a
  -- newer build opens here as long as this number is one this build knows, and
  -- a format written in a language from the future is left alone rather than
  -- read down — the same refusal `SchemaTooNewError` makes about a whole file.
  language   INTEGER NOT NULL,
  -- **The prose, kept verbatim and never parsed**, and it is not decoration.
  -- The vault note this design is specified against is half argument: "these
  -- are dry-weight values, which is what recipes measure" is the sentence that
  -- stops the dish being understated by half. A declaration that dropped it
  -- would be a worse artefact than the markdown file it replaced.
  notes      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- 2 -------------------------------------------------------------------------
-- The columns. Every property here exists to become SQL rather than to be
-- interpreted — a type is a storage class, `required` is `NOT NULL`, a bound is
-- a comparison. **There is no free-text CHECK**, and that is a decision: a
-- declaration carrying SQL is a program, the ruler forbids a formula DSL, and a
-- string from a model that reaches `db.run` is an injection this schema would
-- otherwise invent.

CREATE TABLE format_column (
  format_name TEXT NOT NULL REFERENCES format (name),
  name        TEXT NOT NULL,
  -- Seven, closed, and closed for the same reason a column-role vocabulary is
  -- (D-114, D-212): it is handed to a model as an enum, and a model asked to
  -- use an app's vocabulary unaided invents members of it.
  --
  -- `money` is the one that is not one column. It stores minor units beside a
  -- currency code, because the app's oldest rule has no exception for a table
  -- somebody declared — a declared column holding 19.99 as a float would break
  -- it by construction, in the one place nobody would look.
  type        TEXT NOT NULL CHECK (type IN (
                'text', 'integer', 'real', 'date', 'boolean', 'enum', 'money')),
  -- What the figure is *in* — g, mg, kcal, µg, ml. **Recorded and not yet
  -- interpreted.** The engine owning dimension and conversion is H7 and it is
  -- U4's decision; storing the unit now is what lets that arrive without every
  -- existing declaration being rewritten. What it already buys is the refusal:
  -- a unit change is the one edit that alters no SQL and every meaning, and the
  -- reconciler can only refuse a change it can see.
  unit        TEXT,
  required    INTEGER NOT NULL CHECK (required IN (0, 1)),
  -- Inclusive, and only ever on `integer` and `real`. NULL is unbounded.
  minimum     REAL,
  maximum     REAL,
  -- What the column means, in the author's words.
  note        TEXT NOT NULL DEFAULT '',
  -- The order the columns are declared in, which is the order they are written
  -- in the artefact and the order the table gets them. A format is read by a
  -- person and the order is theirs.
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, name)
);

-- 3 -------------------------------------------------------------------------
-- An enum's members, as rows.
--
-- **A row rather than a comma-separated string in `format_column`**, which
-- would have been shorter and would have been the untyped storage the whole
-- design rejects. The vault reinvented this column independently —
-- `micros_basis: analogue | mixed | label` is `proved / failed / unchecked`
-- (D-149) arrived at again in another domain — so it is worth storing properly.

CREATE TABLE format_column_value (
  format_name TEXT NOT NULL REFERENCES format (name),
  column_name TEXT NOT NULL,
  value       TEXT NOT NULL,
  position    INTEGER NOT NULL,
  PRIMARY KEY (format_name, column_name, value)
);
