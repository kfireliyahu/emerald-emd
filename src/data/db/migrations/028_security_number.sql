-- 028_security_number — the exchange's own number for an instrument, in a column
-- of its own. See docs/04-data-model.md, docs/f18-investments.md and D-195.
--
-- Numbered and immutable after release (D-020).
--
-- **One column added, and no table rebuilt.** Nothing here widens a `CHECK`, so
-- `security` is altered in place — 023's situation rather than 026's and 027's.
--
-- **What it is for.** `מספר נייר` is how a Tel Aviv statement names a security,
-- and it is the only identity an Israeli broker prints: no ISIN, and the ticker
-- column is often not there at all. D-194 put the number in `ticker` because
-- `isin` rejected it — seven digits against ISO 6166's twelve and a Luhn digit —
-- and `ticker` is documented as free text that is *not* a key. So every figure
-- F18 keys on a security was resting on a field two securities may share.
--
-- The index is partial for `isin`'s reason: NULL is not a key, and SQLite would
-- hold any number of rows carrying it.

ALTER TABLE security ADD COLUMN security_number TEXT;

-- **The number the previous release put in `ticker`, moved to where it belongs.**
-- A copy rather than a move: nothing here deletes what the user may have typed
-- (docs/conventions.md), and a ticker that turns out to be a number is still
-- what the screen has been printing for a milestone.
--
-- All digits is the whole test, and it is a fact about the two vocabularies
-- rather than a guess: an exchange symbol carries letters — `VOO`, `TA125`,
-- `POLI` — and a TASE security number is seven digits with nothing else in it.
--
-- **A number already naming two securities is not backfilled**, because the
-- unique index below would then refuse to build and the document would fail to
-- open. That is exactly the duplicate this column exists to prevent, and a
-- migration is not the place to merge two records the user may have meant.
UPDATE security
   SET security_number = ticker
 WHERE deleted_at IS NULL
   AND ticker IS NOT NULL
   AND ticker <> ''
   AND ticker NOT GLOB '*[^0-9]*'
   AND (SELECT COUNT(*)
          FROM security AS other
         WHERE other.deleted_at IS NULL
           AND other.ticker = security.ticker) = 1;

-- One row per number, so next quarter's statement finds the security this one
-- created rather than opening a second position in the same instrument.
CREATE UNIQUE INDEX security_number_key ON security (security_number)
  WHERE security_number IS NOT NULL AND deleted_at IS NULL;
