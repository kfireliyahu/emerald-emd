-- 027 — A plan writes a debt payment on apply (D-106, D-190)
--
-- One column value, and a table rebuild to add it: `debt_payment.source_kind`
-- gains `FROM_PLAN`. SQLite cannot alter a `CHECK`, and migrations are immutable
-- after release (D-020), so widening a vocabulary means writing the table again
-- — exactly what 024 did to `saving_deposit` for the same kind of reason.
--
-- **Nothing else about the table moves.** Same columns, same order, same
-- defaults, same `REFERENCES`, same indexes, same partial-unique predicate. The
-- `INSERT ... SELECT` is column-for-column, so no figure can shift: a rebuild
-- that also tidied something would make "did this migration move a balance"
-- unanswerable, and a debt balance is Σ the principal of these rows.
--
-- **The unique index needs no change**, which is worth writing down because the
-- roadmap said otherwise for a milestone. It excludes `MANUAL` and nothing else,
-- so `FROM_PLAN` is keyed the moment the kind exists — one payment per
-- `(debt_id, 'FROM_PLAN', planId:period:bucketId)`, which is the constraint
-- behind `applyPlanPayment`'s upsert.

CREATE TABLE debt_payment_new (
  id                TEXT PRIMARY KEY NOT NULL,
  debt_id           TEXT NOT NULL REFERENCES debt (id),
  date              TEXT NOT NULL,
  currency          TEXT NOT NULL,
  amount_minor      INTEGER NOT NULL,
  interest_minor    INTEGER NOT NULL DEFAULT 0,
  -- **The one difference from 020.** `FROM_PLAN` is spelled as `saving_deposit`
  -- spells it (018, kept by 019 and 024), because it is the same event on the
  -- other side of the split: a bucket the user accepted, written per plan per
  -- month per bucket.
  source_kind       TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source_kind IN (
                      'MANUAL', 'TRANSACTION', 'PAYCHECK', 'INSTALLMENT_SLICE',
                      'FROM_PLAN')),
  -- The transaction id, the `paycheckId:debtId` pair, the slice's row, or now
  -- `planId:period:bucketId`. Still no `REFERENCES`, for 020's reason: it points
  -- at different tables depending on the kind.
  source_ref_id     TEXT,
  is_confirmed      INTEGER NOT NULL DEFAULT 1,
  note              TEXT,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

INSERT INTO debt_payment_new (
  id, debt_id, date, currency, amount_minor, interest_minor, source_kind,
  source_ref_id, is_confirmed, note, created_at, updated_at, deleted_at
)
SELECT
  id, debt_id, date, currency, amount_minor, interest_minor, source_kind,
  source_ref_id, is_confirmed, note, created_at, updated_at, deleted_at
FROM debt_payment;

DROP TABLE debt_payment;

ALTER TABLE debt_payment_new RENAME TO debt_payment;

-- Recreated exactly as 020 wrote them.
CREATE INDEX debt_payment_debt_date ON debt_payment (debt_id, date);

CREATE UNIQUE INDEX debt_payment_source
  ON debt_payment (debt_id, source_kind, source_ref_id)
  WHERE deleted_at IS NULL AND source_kind <> 'MANUAL' AND source_ref_id IS NOT NULL;
