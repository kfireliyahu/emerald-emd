-- 007_installment_group_and_original_total — the two facts a statement states
-- once, at import time, and never again.
--
-- Numbered and immutable after release (D-020). See docs/04-data-model.md
-- ("Installment") and D-035.
--
-- `installment_sequence` and `installment_total` already gave "3 of 12". What
-- was missing is what makes a group: which purchase the slice belongs to, and
-- what that purchase cost. Both are on the row being parsed and on no row
-- afterwards — D-007 stores the group link precisely so a purchase-basis view
-- and M6's installment-group-to-debt promotion can be built later, and neither
-- can be back-filled from a ledger that never captured it.

-- Derived from merchant + original date + original total, never read from a
-- file: no Israeli provider ships a purchase identifier. The derivation is
-- `installmentGroupKey` in src/domain/installments.ts, and it is the reason
-- this column is not UNIQUE — every slice of one purchase carries the same key.
ALTER TABLE "transaction" ADD COLUMN installment_group_key TEXT;

-- The whole purchase, as a magnitude in the transaction's own currency. No
-- currency column of its own: this is only ever stated in the currency the
-- charge was made in — a purchase price in *another* currency is a
-- ForeignAmount, which is the distinction D-035 is about.
ALTER TABLE "transaction" ADD COLUMN original_total_minor INTEGER;

-- The staging area carries the parsed draft as columns (003), so both fields
-- have to survive a review that is closed and resumed before it is committed.
ALTER TABLE staged_row ADD COLUMN installment_group_key TEXT;
ALTER TABLE staged_row ADD COLUMN original_total_minor INTEGER;

-- "The other slices of this purchase" is the one query the group key exists to
-- answer. Partial, so the index holds only installment rows rather than a NULL
-- for every ordinary charge in the ledger.
CREATE INDEX transaction_installment_group
  ON "transaction" (installment_group_key)
  WHERE installment_group_key IS NOT NULL AND deleted_at IS NULL;
