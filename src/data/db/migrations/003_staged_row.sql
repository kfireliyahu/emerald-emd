-- 003_staged_row — the pre-commit staging area. See docs/04-data-model.md
-- ("StagedRow") and docs/f01-card-statement-import.md pipeline steps 12–14.
--
-- Numbered and immutable after release: a released migration is never edited,
-- only superseded by the next number. See D-020 and docs/02-architecture.md.
--
-- This is what makes the review step real. Until now a parse lived in React
-- state and a commit went straight from it into the ledger, so closing the tab
-- mid-import lost the work and there was nowhere to record a per-row decision.
--
-- **The parsed draft is columns, not a JSON blob.** docs/04 calls it a
-- "Transaction-shaped draft", and shaping it literally is what lets the review
-- screen count and filter by status in SQL over thousands of rows instead of
-- parsing every row in JavaScript to answer "how many are new". It is also the
-- same shape the commit copies into "transaction", which keeps that copy
-- obvious.
--
-- Every draft column is nullable, because a row that failed to parse has no
-- date, no amount and no merchant and still has to appear in the review with
-- its raw cells and its error.

CREATE TABLE staged_row (
  id                    TEXT PRIMARY KEY NOT NULL,
  session_id            TEXT NOT NULL REFERENCES import_session (id),
  -- 0-based, as the parser saw it. Add one for the row number the spreadsheet
  -- shows, which is the only number an error message may quote.
  row_index             INTEGER NOT NULL,
  -- The row as text, one JSON array of cell strings. Cell *types* are not kept:
  -- they are re-derivable by re-importing the file, this table is transient,
  -- and a 5,000-row statement should not carry a second typed copy of itself
  -- around inside the document.
  raw_cells             TEXT NOT NULL,

  status                TEXT NOT NULL CHECK (status IN (
                          'NEW', 'DUPLICATE_EXACT', 'DUPLICATE_SIMILAR',
                          'UPDATED', 'PARSE_ERROR', 'SKIPPED')),
  -- Nothing is auto-accepted (docs/conventions.md). The bulk "accept all new"
  -- on the review screen is what makes the common case one click.
  user_decision         TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (user_decision IN ('PENDING', 'ACCEPT', 'SKIP', 'EDIT')),
  error_message         TEXT,
  -- Two category columns, not one. `suggested` is the rules engine's answer
  -- (F03, not built yet); `chosen` is what the user picked in the review
  -- screen's inline picker. Collapsing them would mean a manual choice landing
  -- in a column named "suggested" and being indistinguishable from a guess —
  -- and D-009 turns on being able to tell those apart forever.
  suggested_category_id TEXT REFERENCES category (id),
  chosen_category_id    TEXT REFERENCES category (id),

  -- The parsed draft. Null throughout on a PARSE_ERROR or SKIPPED row.
  transaction_date      TEXT,
  charge_date           TEXT,
  billing_period        TEXT,
  amount_minor          INTEGER,
  currency              TEXT,
  direction             TEXT CHECK (direction IS NULL OR direction IN ('OUTFLOW', 'INFLOW', 'TRANSFER')),
  merchant_raw          TEXT,
  merchant_normalized   TEXT,
  provider_category     TEXT,
  card_last4            TEXT,
  reference             TEXT,
  note                  TEXT,
  installment_sequence  INTEGER,
  installment_total     INTEGER,
  foreign_amount_minor  INTEGER,
  foreign_currency      TEXT,
  exchange_rate         REAL,
  natural_key           TEXT,
  source_row_ref        TEXT,

  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,

  -- The same agreement between sign and direction the ledger enforces (D-004),
  -- so a sign bug is caught in staging rather than at the commit that copies it.
  CHECK (
    direction IS NULL
    OR (direction = 'OUTFLOW' AND amount_minor <= 0)
    OR (direction = 'INFLOW' AND amount_minor >= 0)
    OR direction = 'TRANSFER'
  ),

  -- One staged row per sheet row per session. Re-staging a session replaces its
  -- rows rather than doubling them.
  UNIQUE (session_id, row_index)
);

-- The review screen's two queries: the ordered page, and the counts per status.
CREATE INDEX staged_row_review ON staged_row (session_id, status, user_decision);

-- "You closed the tab mid-import" — find the session still waiting for review.
CREATE INDEX import_session_status ON import_session (status, created_at);
