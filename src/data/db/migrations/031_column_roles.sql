-- 031_column_roles — the four reading vocabularies become rows. See
-- docs/04-data-model.md, docs/engine.md and D-212.
--
-- Numbered and immutable after release (D-020).
--
-- **What this is for.** M16 read a real broker statement's portfolio as
-- ₪72,000.00 against a printed ₪76,000.00, and the cause was not the reader:
-- `HOLDING_COLUMN_ROLES` had eight members and no `cost`, so `עלות הרכישה` had
-- nowhere to go but `ignore` and a model put it in `value` (D-208). A
-- vocabulary compiled into the binary cannot name a column a document prints,
-- and the same wall had already been hit by payslips, fund reports and trades.
-- This table is where the four lists live instead.
--
-- **It does not make the lists open, and that distinction is the whole design.**
-- They are closed because they become JSON Schema `enum`s in the grammar handed
-- to a model, and unaided a model asked to use an app's vocabulary invents
-- members of it (D-114). The list is still closed at the moment the model is
-- asked — it is built from these rows at task time rather than from a `const`.
-- What changes is only that the rows can differ between documents.
--
-- **`deduction_type` is the precedent, and it is exact** (012, D-049): a real
-- table whose rows the user creates, carrying a foreign key into another
-- entity. Correctness never came from a vocabulary being fixed, only from its
-- being real — what forfeits a CHECK is untyped storage, not who authored the
-- row (D-209).
--
-- **A user-added role is named, not stored** (D-211). Nothing reads it: it
-- exists so a model has a right answer that is not `value`, and the figure in
-- that column goes nowhere until a format declares a column for it. That is
-- still strictly better than `ignore`, because the column keeps its name for
-- when one does.
--
-- **`cost` is deliberately not seeded.** Widening that list was declined
-- in D-208 and seeding it here would be the same act by another mechanism. A
-- person adds it, from the mapper, which is also what proves this path against
-- a real statement.

CREATE TABLE column_role (
  -- Which reading this role belongs to. Four, because there are four tables an
  -- Israeli financial document prints and each has its own idea of what a
  -- column can mean. A role is unique within its vocabulary and says nothing
  -- about the others: `quantity` on a holdings table and `quantity` on a trades
  -- table are the same word for two different readings.
  vocabulary TEXT NOT NULL CHECK (vocabulary IN ('STATEMENT', 'DEPOSIT', 'HOLDING', 'TRADE')),
  role       TEXT NOT NULL,
  -- `SEEDED` is one this build shipped and whose meaning is compiled in — a
  -- reader narrows on it and does something particular. `USER` is one somebody
  -- added because a document printed a column this build has no name for;
  -- nothing narrows on it and nothing stores its figure (D-211).
  --
  -- The distinction is not decoration. It is what lets the existing switches
  -- keep their exhaustiveness: a seeded role is still a member of a literal
  -- union the compiler checks, and an added one is by construction a role no
  -- code can reach.
  origin     TEXT NOT NULL CHECK (origin IN ('SEEDED', 'USER')),
  -- The order the roles are offered in and the order they enter the grammar.
  -- Seeded rows carry the order the `const` arrays had, so a model sees exactly
  -- the list it saw before this migration; an added role sorts after them.
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vocabulary, role)
);

-- 1 -------------------------------------------------------------------------
-- STATEMENT — `COLUMN_ROLES`, the statement importer's eighteen, in the order
-- `domain/model/importing.ts` declared them. `date`, `amount` and `merchant`
-- are `REQUIRED_ROLES` and stay required in code; requiredness is a property of
-- the reading rather than of the vocabulary, so it is not a column here.

INSERT INTO column_role (vocabulary, role, origin, position) VALUES
  ('STATEMENT', 'date',                'SEEDED',  0),
  ('STATEMENT', 'amount',              'SEEDED',  1),
  ('STATEMENT', 'merchant',            'SEEDED',  2),
  ('STATEMENT', 'debit',               'SEEDED',  3),
  ('STATEMENT', 'credit',              'SEEDED',  4),
  ('STATEMENT', 'chargeDate',          'SEEDED',  5),
  ('STATEMENT', 'currency',            'SEEDED',  6),
  ('STATEMENT', 'originalAmount',      'SEEDED',  7),
  ('STATEMENT', 'originalCurrency',    'SEEDED',  8),
  ('STATEMENT', 'exchangeRate',        'SEEDED',  9),
  ('STATEMENT', 'providerCategory',    'SEEDED', 10),
  ('STATEMENT', 'installmentText',     'SEEDED', 11),
  ('STATEMENT', 'installmentSequence', 'SEEDED', 12),
  ('STATEMENT', 'installmentTotal',    'SEEDED', 13),
  ('STATEMENT', 'cardLast4',           'SEEDED', 14),
  ('STATEMENT', 'reference',           'SEEDED', 15),
  ('STATEMENT', 'balance',             'SEEDED', 16),
  ('STATEMENT', 'note',                'SEEDED', 17);

-- 2 -------------------------------------------------------------------------
-- DEPOSIT — `DEPOSIT_COLUMN_ROLES`, the deposit table inside a fund report
-- (D-153). `ignore` is a member here and in all three below, and it is not
-- filler: a role is **positional**, so a list that could name only the useful
-- columns could not say where they are.

INSERT INTO column_role (vocabulary, role, origin, position) VALUES
  ('DEPOSIT', 'employerName', 'SEEDED', 0),
  ('DEPOSIT', 'depositDate',  'SEEDED', 1),
  ('DEPOSIT', 'salaryMonth',  'SEEDED', 2),
  ('DEPOSIT', 'salary',       'SEEDED', 3),
  ('DEPOSIT', 'employee',     'SEEDED', 4),
  ('DEPOSIT', 'employer',     'SEEDED', 5),
  ('DEPOSIT', 'severance',    'SEEDED', 6),
  ('DEPOSIT', 'total',        'SEEDED', 7),
  ('DEPOSIT', 'ignore',       'SEEDED', 8);

-- 3 -------------------------------------------------------------------------
-- HOLDING — `HOLDING_COLUMN_ROLES`, a broker's positions table. Eight, exactly
-- as shipped, and **without `cost`**: see the head of this file.

INSERT INTO column_role (vocabulary, role, origin, position) VALUES
  ('HOLDING', 'securityName',   'SEEDED', 0),
  ('HOLDING', 'securityNumber', 'SEEDED', 1),
  ('HOLDING', 'ticker',         'SEEDED', 2),
  ('HOLDING', 'isin',           'SEEDED', 3),
  ('HOLDING', 'quantity',       'SEEDED', 4),
  ('HOLDING', 'unitPrice',      'SEEDED', 5),
  ('HOLDING', 'value',          'SEEDED', 6),
  ('HOLDING', 'ignore',         'SEEDED', 7);

-- 4 -------------------------------------------------------------------------
-- TRADE — `TRADE_COLUMN_ROLES`, the movements table on the same statement.
-- There is no `tax` and that is a decision rather than a gap: the charged
-- amount already has the tax inside it, and storing it beside would be two
-- records of one fact (D-036).

INSERT INTO column_role (vocabulary, role, origin, position) VALUES
  ('TRADE', 'date',           'SEEDED',  0),
  ('TRADE', 'securityName',   'SEEDED',  1),
  ('TRADE', 'securityNumber', 'SEEDED',  2),
  ('TRADE', 'ticker',         'SEEDED',  3),
  ('TRADE', 'isin',           'SEEDED',  4),
  ('TRADE', 'side',           'SEEDED',  5),
  ('TRADE', 'quantity',       'SEEDED',  6),
  ('TRADE', 'unitPrice',      'SEEDED',  7),
  ('TRADE', 'consideration',  'SEEDED',  8),
  ('TRADE', 'fee',            'SEEDED',  9),
  ('TRADE', 'ignore',         'SEEDED', 10);
