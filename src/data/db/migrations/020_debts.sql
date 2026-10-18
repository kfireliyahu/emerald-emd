-- 020_debts — what is owed, and the payments it comes down by. See
-- docs/f08-debts.md, docs/04-data-model.md ("Debts") and D-083.
--
-- Numbered and immutable after release (D-020).
--
-- **There is no outstanding column**, and that is the whole shape of this
-- migration, exactly as it was 018's. docs/f08 opens by inverting the feature on
-- that point: a debt does not have a stored balance that something updates, it
-- has a principal and a stream of payments, so the question stops being "how
-- does the balance get updated" and becomes "how do payments get discovered" —
-- which has four clean answers, one per `auto_track_kind` plus the payroll link
-- that already lives on `deduction_type`. The domain that reads these tables has
-- no function that accepts a balance (D-083), so there is nothing here for one
-- to be stored *for*.
--
-- **And there is no principal column on a payment.** docs/04 lists
-- `principalPortion` beside `interestPortion`, which is two amounts with an
-- arithmetic relation between them and therefore two ways for one payment to
-- disagree with itself. Only the interest is stored; principal is
-- `amount − interest`, and `principalOf` is the one function that says so. The
-- subtraction that matters — outstanding counts down by principal, never by
-- amount — cannot then be got wrong flatteringly by a caller reaching for the
-- obvious column.

CREATE TABLE debt (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'MORTGAGE', 'BANK_LOAN', 'CARD_INSTALLMENTS',
                      'PAYROLL_LOAN', 'PERSONAL', 'OTHER')),
  -- **One currency for the debt**, shared by the principal and the expected
  -- monthly payment. The domain holds them as two `Money` values and
  -- `validateDebt` reports `MIXED_CURRENCY` when they disagree; this column makes
  -- that state unrepresentable rather than merely rejected, which is the same
  -- narrowing `saving_deposit` applied to a deposit's own pair. A mortgage in
  -- euros repaid in shekels is a conversion, and there is no rate in this
  -- document (D-003).
  currency          TEXT NOT NULL,
  -- The original amount borrowed. What outstanding counts down from.
  principal_minor   INTEGER NOT NULL,
  -- Date-only, `YYYY-MM-DD`, never an epoch. D-023.
  opened_date       TEXT NOT NULL,
  expected_end_date TEXT,
  -- The expected payment, which is what projects a debt with no history yet.
  -- Nullable and meant to be: money owed to a friend states no schedule, and
  -- `projectPayoff` answers `NO_BASIS` rather than inventing one.
  monthly_payment_minor INTEGER,
  -- Informational. Discovery does not read it — a payment is found by the
  -- mechanisms below, not by the account it left.
  linked_account_id TEXT REFERENCES account (id),

  -- The two tracking columns are **one discriminated union in the domain**, so a
  -- kind cannot travel without its ref or carry the ref of the kind it used to
  -- be. The CHECK at the foot of this table is that union written in SQL: `NONE`
  -- has no ref and every other kind has one. It matters more than it reads — the
  -- ref is interpreted by three different mechanisms, and the wrong one reading
  -- it finds payments that never happened.
  auto_track_kind   TEXT NOT NULL DEFAULT 'NONE' CHECK (auto_track_kind IN (
                      'NONE', 'MERCHANT_PATTERN', 'CATEGORY',
                      'CARD_INSTALLMENT_GROUP')),
  -- The merchant pattern, the category id, or the installment group key. No
  -- REFERENCES: it points at a different table per kind, and two of the three
  -- kinds do not point at a table at all — the call D-056 made for
  -- `split_bucket.target_id`.
  auto_track_ref    TEXT,

  -- Paid off or written off. Keeps its history; takes no new payments, and
  -- `discoverPayments` skips it so a closed debt cannot be revived by a rescan.
  is_closed         INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER,

  CHECK ((auto_track_kind = 'NONE' AND auto_track_ref IS NULL)
      OR (auto_track_kind <> 'NONE' AND auto_track_ref IS NOT NULL))
);

-- The debts screen's order: open first, then by name. The one index the list
-- needs, and the same shape `saving_goal_priority` takes.
CREATE INDEX debt_open ON debt (is_closed, name);

-- Discovery reads every open debt's tracking on every scan, and `debtWarnings`
-- asks whether another debt already watches this ref.
CREATE INDEX debt_tracking ON debt (auto_track_kind, auto_track_ref)
  WHERE auto_track_kind <> 'NONE' AND deleted_at IS NULL;

CREATE TABLE debt_payment (
  id                TEXT PRIMARY KEY NOT NULL,
  debt_id           TEXT NOT NULL REFERENCES debt (id),
  date              TEXT NOT NULL,
  -- One currency for the pair below, for the reason `debt.currency` is one for
  -- its own pair. `principalOf` has a branch for a payment whose interest is in
  -- another currency — it counts the payment as all principal rather than
  -- letting a balance disagree with the list printed under it — and this column
  -- means that branch guards a shape the document cannot hold.
  currency          TEXT NOT NULL,
  -- **A magnitude, always positive.** Direction is not a question a debt asks:
  -- a payment reduces what is owed, and a negative one would be a refund, which
  -- is a different event with no meaning here. `discoverPayments` reads the
  -- ledger's sign (D-004) and stores the absolute value.
  amount_minor      INTEGER NOT NULL,
  -- The part that did not reduce what is owed. Zero unless the user says
  -- otherwise, which is docs/04's all-principal default reached without a second
  -- column to keep in step. v1 has no amortization engine (docs/f08's settled
  -- open question); this is the manual override it settled on instead.
  interest_minor    INTEGER NOT NULL DEFAULT 0,
  source_kind       TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source_kind IN (
                      'MANUAL', 'TRANSACTION', 'PAYCHECK', 'INSTALLMENT_SLICE')),
  -- The transaction id, the `paycheckId:debtId` pair, or the slice's row. No
  -- REFERENCES, for `saving_deposit.source_ref_id`'s reason: it points at
  -- different tables depending on the kind.
  --
  -- `PAYCHECK`, not `PAYCHECK_LINE`: a `PaycheckLine.id` does not survive an
  -- edit, because `updatePaycheck` deletes a slip's lines and writes them again.
  -- A payment keyed on one would be orphaned and recreated by every correction —
  -- the exact duplication the unique index below forbids, produced by the
  -- mechanism meant to prevent it. D-075 found it in F07 first.
  source_ref_id     TEXT,
  -- **Not a filter.** A discovered payment starts unconfirmed and still counts
  -- towards the balance, because the money left the account whether or not the
  -- user has agreed the app read the row correctly. docs/f08 asks for it to be
  -- marked, not withheld, and `debtBalance` reports the unconfirmed share beside
  -- the total for exactly that reason: a balance that jumps when a queue is
  -- cleared is a balance nobody trusts.
  is_confirmed      INTEGER NOT NULL DEFAULT 1,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- The payment history, the balance and the review queue read these two columns
-- in this order.
CREATE INDEX debt_payment_debt_date ON debt_payment (debt_id, date);

-- **One payment per `(debt_id, source_kind, source_ref_id)`** — docs/04's
-- invariant and F08's first acceptance criterion, which is that re-importing
-- three months of statements twice produces the same balances. What "the same
-- payment" means is `paymentSourceKey` in the domain, and the repository's
-- upsert reads that same definition, so the index and the code cannot come to
-- disagree.
--
-- The debt is **in** the key. One transaction can legitimately pay two debts
-- when the user says so, and a key without the debt in it would quietly make
-- that impossible while looking like it enforced something else.
--
-- `MANUAL` rows are excluded rather than NULL-keyed: two identical payments
-- entered by hand on one day are two payments, because the user made two.
-- Partial on `deleted_at IS NULL` for the reason every unique index in this
-- schema is — SQLite treats NULLs as distinct, so unique-among-the-living has to
-- be spelled out.
CREATE UNIQUE INDEX debt_payment_source
  ON debt_payment (debt_id, source_kind, source_ref_id)
  WHERE deleted_at IS NULL AND source_kind <> 'MANUAL' AND source_ref_id IS NOT NULL;

-- **`deduction_type.linked_debt_id` is now writable, and still has no foreign
-- key.** Migration 012 left all three link columns unconstrained because none of
-- the tables they point at existed; `debt` is the last of the three to arrive,
-- and adding the constraint would mean rebuilding `deduction_type` — which
-- SQLite requires for adding one to an existing column — on every document that
-- already exists, dropping and recreating a table `paycheck_line` holds ids
-- into, to gain nothing enforced: this app never runs `PRAGMA foreign_keys = ON`
-- (D-067, restated by 018).
--
-- What keeps it honest is `deleteDebt`, which clears every type that named the
-- debt, exactly as `deleteGoal` and `deleteFund` do. A link to a debt that is
-- gone would go on discovering payroll payments for something nobody can see.
