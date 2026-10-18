-- 021_document_templates — how a label-value document is read, stored so the
-- second one of a format needs no model. See docs/f17-mapping-templates.md,
-- docs/04-data-model.md ("DocumentTemplate") and D-132, D-139.
--
-- Numbered and immutable after release (D-020).
--
-- **This is `import_mapping` for documents that have no header row.** A
-- statement is a grid and its schema is the header cells; a payslip or a fund
-- report is a page, and its schema is the words that do not change between
-- months — the field labels, the employer's name, the page furniture. The
-- numbers are the data. Normalize the labels, sort them, and that is a
-- signature in the same sense `signature.ts` already means it.
--
-- **The map anchors to labels, never to coordinates or to line numbers.** A
-- model answers with a line number (D-137, because a JSON grammar truncates a
-- Hebrew label at its gershayim), and code reads the label off that line before
-- anything is stored. What is stored therefore survives a moved logo, a new page
-- size, an inserted row and a reflowed footer — all of which move every line
-- number on the page and none of which move a label.
--
-- **No table here holds a figure**, and that is the property to check before
-- adding a column. A template says where a number is; reading it is
-- `payslipTemplate.ts` and it happens every time the document is opened. A
-- stored amount would be a second copy of something the document already states,
-- and the first thing to go stale.

CREATE TABLE document_template (
  id               TEXT PRIMARY KEY NOT NULL,
  -- FUND_REPORT is in the list before anything can write one: SQLite cannot
  -- alter a CHECK without rebuilding the table, and a fund report is the same
  -- kind of thing read by the same ladder. The repository decodes the shapes it
  -- has, and skips a row whose kind it does not — the same defence every
  -- `import_mapping` decode already applies.
  kind             TEXT NOT NULL CHECK (kind IN ('PAYSLIP', 'FUND_REPORT')),
  -- What a person calls this format — an employer, a provider. Named by the
  -- user at the confirm step; seeded from the document until then.
  name             TEXT NOT NULL,
  -- `lv1`, the label count, and the normalized labels, joined on U+001F. Kept
  -- as the labels rather than reduced to a hash for the reason the header
  -- signature is: a hash answers "same or not", and the useful answer is
  -- **how close** — one changed month name must not read as a new employer.
  label_signature  TEXT NOT NULL,
  -- The field map: JSON, shaped by `kind`, decoded defensively. Anchors, column
  -- flags and the line each field was found on when it was derived — the last
  -- being a hint for the confirm surface, never how a field is found again.
  anchors          TEXT NOT NULL,

  -- Which rung of F17's ladder produced this. MANUAL is the user pointing at
  -- the fields, which is the rung that always terminates.
  derived_by       TEXT NOT NULL CHECK (derived_by IN (
                     'LOCAL_MODEL', 'PLUGIN', 'SEED', 'MANUAL')),
  -- **Null until a human agreed to it**, which is the milestone's standing rule
  -- written as a column: nothing is written without a human action. An
  -- unconfirmed template is a proposal, and the reader refuses to execute one.
  confirmed_at     INTEGER,
  -- The fields the user corrected by hand, as a JSON array of field names.
  -- Re-derivation carries these over rather than writing across them — "user
  -- overrides win" (conventions), applied to a template.
  pinned_fields    TEXT NOT NULL DEFAULT '[]',

  -- **Versioned, and old versions are kept.** Last year's slips still need the
  -- map that read them, so a re-derivation supersedes rather than updates: the
  -- old row keeps its anchors and gains a `superseded_at`.
  version          INTEGER NOT NULL DEFAULT 1,
  superseded_at    INTEGER,

  last_used_at     INTEGER,
  use_count        INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL DEFAULT 0,
  deleted_at       INTEGER
);

-- **One current template per format**, and the ladder's first rung reads this
-- index: this document's signature against what is stored.
--
-- Unique is where this table parts company
-- with `import_mapping` — that one allows two rows to share a signature because
-- `duplicateMapping` is the user asking for a copy, and the matcher has a total
-- order to break the tie with. Nothing here duplicates a template on purpose,
-- and two current rows for one format would make "the template no longer
-- verifies, derive a new one" ambiguous about which one just failed. Superseded
-- and deleted rows are outside the index, which is what lets a version chain
-- exist at all.
CREATE UNIQUE INDEX document_template_current
  ON document_template (kind, label_signature)
  WHERE superseded_at IS NULL AND deleted_at IS NULL;
