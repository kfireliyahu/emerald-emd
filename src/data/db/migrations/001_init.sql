-- 001_init — the smallest schema that lets an import be committed and survive.
--
-- Numbered and immutable after release: a released migration is never edited,
-- only superseded by the next number. See D-020 and docs/02-architecture.md.
--
-- Only the four entities step 3 of docs/13-start-here.md calls for. Categories,
-- paychecks, plans, savings, debts and funds arrive with the features that need
-- them, each with its own migration.

CREATE TABLE account (
  id                    TEXT PRIMARY KEY NOT NULL,
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('CREDIT_CARD', 'BANK', 'CASH')),
  last4                 TEXT,
  default_billing_day   INTEGER,
  is_archived           INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER
);

CREATE TABLE import_mapping (
  id                  TEXT PRIMARY KEY NOT NULL,
  name                TEXT NOT NULL,
  account_id          TEXT REFERENCES account (id),
  -- The normalized header cells, joined. How a later file is recognised as
  -- being this same format.
  header_signature    TEXT NOT NULL,
  sheet_name          TEXT,
  header_row_index    INTEGER NOT NULL,
  data_start_row_index INTEGER NOT NULL,
  -- JSON, because the shape is a map whose keys are column indices and whose
  -- meaning is owned by the importer, not by SQL.
  column_roles        TEXT NOT NULL,
  amount_convention   TEXT NOT NULL,
  date_orders         TEXT NOT NULL,
  default_currency    TEXT NOT NULL,
  last_used_at        INTEGER,
  use_count           INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER
);

CREATE TABLE import_session (
  id                TEXT PRIMARY KEY NOT NULL,
  account_id        TEXT NOT NULL REFERENCES account (id),
  mapping_id        TEXT REFERENCES import_mapping (id),
  file_name         TEXT NOT NULL,
  -- Detects "you have already imported this exact file" before anything else.
  file_hash         TEXT NOT NULL,
  sheet_name        TEXT,
  row_count_total   INTEGER NOT NULL DEFAULT 0,
  row_count_new     INTEGER NOT NULL DEFAULT 0,
  row_count_duplicate INTEGER NOT NULL DEFAULT 0,
  row_count_failed  INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,
  committed_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE "transaction" (
  id                  TEXT PRIMARY KEY NOT NULL,
  account_id          TEXT NOT NULL REFERENCES account (id),
  -- Date-only, stored as YYYY-MM-DD text. Never an epoch: these are calendar
  -- facts with no timezone, and an epoch would smuggle one in. See D-023.
  transaction_date    TEXT NOT NULL,
  charge_date         TEXT,
  billing_period      TEXT,
  -- Money is minor units plus a currency, never a float. D-003.
  amount_minor        INTEGER NOT NULL,
  currency            TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('OUTFLOW', 'INFLOW', 'TRANSFER')),
  merchant_raw        TEXT NOT NULL,
  merchant_normalized TEXT NOT NULL,
  provider_category   TEXT,
  card_last4          TEXT,
  reference           TEXT,
  note                TEXT,
  installment_sequence INTEGER,
  installment_total   INTEGER,
  foreign_amount_minor INTEGER,
  foreign_currency    TEXT,
  exchange_rate       REAL,
  is_excluded_from_stats INTEGER NOT NULL DEFAULT 0,
  -- Deterministic dedupe key. The uniqueness below is what makes importing the
  -- same file twice a no-op rather than a doubling.
  natural_key         TEXT NOT NULL,
  import_session_id   TEXT REFERENCES import_session (id),
  source_row_ref      TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,

  -- Sign and direction must agree, or refunds start inflating spending. D-004.
  CHECK (
    (direction = 'OUTFLOW' AND amount_minor <= 0)
    OR (direction = 'INFLOW' AND amount_minor >= 0)
    OR direction = 'TRANSFER'
  )
);

-- Unique per account among rows that are not soft-deleted. SQLite treats NULLs
-- as distinct in a unique index, so a partial index on deleted_at IS NULL is
-- what actually enforces "unique among the living".
CREATE UNIQUE INDEX transaction_natural_key
  ON "transaction" (account_id, natural_key)
  WHERE deleted_at IS NULL;

CREATE INDEX transaction_dates ON "transaction" (account_id, charge_date, transaction_date);
CREATE INDEX transaction_merchant ON "transaction" (merchant_normalized);
-- Deliberately not unique. docs/f01 requires that a file you already imported
-- can be re-run — after improving a mapping, for instance. The guarantee that
-- re-importing cannot double the ledger comes from the natural key above, not
-- from forbidding the session. This index is only here to make the "you already
-- imported this on <date>" lookup fast.
CREATE INDEX import_session_file_hash ON import_session (account_id, file_hash);
