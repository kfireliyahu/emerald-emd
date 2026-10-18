-- 026_investment_templates — a third kind of document the ladder can read.
-- See docs/f17-mapping-templates.md, docs/f18-investments.md and D-188.
--
-- Numbered and immutable after release (D-020).
--
-- **One `CHECK`, and it costs a table rebuild.** 021 wrote
-- `kind IN ('PAYSLIP', 'FUND_REPORT')` and SQLite cannot alter a constraint in
-- place, so the four-step rebuild — create, copy, drop, rename — is the whole
-- of this migration. It is worth saying that 021 already anticipated this: its
-- comment on the column says the kinds are "a kind of thing read by the same
-- ladder", and adding one is what that sentence was written for.
--
-- **Nothing else changes and no figure moves.** Every column, default, index and
-- unique predicate is carried across exactly as 021 wrote them, and the copy is
-- a straight `SELECT *`-shaped insert. A document with no investment statement
-- in it reads identically either side.
--
-- **The alternative was to drop the constraint**, and it was rejected for the
-- reason it exists: `kind` and `anchors.shape` are one row's two names for
-- itself, the repository refuses to decode a row whose two disagree
-- (`SHAPE_OF_KIND`), and a column that admitted anything would let a hand-edited
-- file write a kind no reader has.

CREATE TABLE document_template_new (
  id               TEXT PRIMARY KEY NOT NULL,
  -- The three kinds of document F17's ladder reads. `INVESTMENT` is a broker
  -- or platform statement: an account total, its cash, and a holdings table
  -- that is rows with no labels (D-188).
  kind             TEXT NOT NULL CHECK (kind IN ('PAYSLIP', 'FUND_REPORT', 'INVESTMENT')),
  name             TEXT NOT NULL,
  label_signature  TEXT NOT NULL,
  anchors          TEXT NOT NULL,
  derived_by       TEXT NOT NULL CHECK (derived_by IN (
                     'LOCAL_MODEL', 'PLUGIN', 'SEED', 'MANUAL')),
  confirmed_at     INTEGER,
  pinned_fields    TEXT NOT NULL DEFAULT '[]',
  version          INTEGER NOT NULL DEFAULT 1,
  superseded_at    INTEGER,
  last_used_at     INTEGER,
  use_count        INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL DEFAULT 0,
  deleted_at       INTEGER
);

INSERT INTO document_template_new (
  id, kind, name, label_signature, anchors, derived_by, confirmed_at, pinned_fields,
  version, superseded_at, last_used_at, use_count, created_at, updated_at, deleted_at
)
SELECT
  id, kind, name, label_signature, anchors, derived_by, confirmed_at, pinned_fields,
  version, superseded_at, last_used_at, use_count, created_at, updated_at, deleted_at
FROM document_template;

DROP TABLE document_template;

ALTER TABLE document_template_new RENAME TO document_template;

-- 021's index, recreated exactly as it wrote it — the partial predicate
-- included, which is what lets a version chain exist at all.
CREATE UNIQUE INDEX document_template_current
  ON document_template (kind, label_signature)
  WHERE superseded_at IS NULL AND deleted_at IS NULL;
