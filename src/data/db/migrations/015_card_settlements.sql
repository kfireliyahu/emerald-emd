-- 015_card_settlements — the link between a bank row and the card statement it
-- pays, and the answer the user gives about it once. See
-- docs/f06-bank-statement-import.md, docs/04-data-model.md
-- ("CardSettlementLink") and D-061.
--
-- Numbered and immutable after release (D-020).
--
-- **What is stored here is what cannot be derived.** The domain that produces
-- these links (D-060) re-derives everything else on demand: which rows are card
-- settlements, which card they belong to, which period they settle. That is
-- deliberate — a bank row's reading changes the moment a card statement arrives,
-- and docs/f06 requires order of import not to matter. Two things survive that
-- re-derivation and so need a home:
--
-- 1. **The user's answer.** Nothing computes it, and the app never guesses one.
-- 2. **The confidence they were shown when they gave it.** A fact about that
--    moment, not about today's ledger — the same reason `staged_row` carries
--    `suggested_rule_id` rather than recomputing it at commit (D-038).
--
-- There is no `row_class` column, here or anywhere. See D-060.

-- The remembered answer to "should I ignore this card's monthly charge in the
-- bank statement?" — docs/04's `excludeSettlementsFromStats`.
--
-- **A column on `account`, which is the opposite of what D-053 chose for the
-- fixed-expense dismissal**, and the difference is what a dismissal lacks: this
-- belongs to a row that already exists. It is keyed by that account, dies with
-- it, is edited from the screen that edits the rest of it, and an `app_setting`
-- key would be a second place a card's identity lives. D-053's dismissal is a
-- set of merchant strings with no row to hang off, which is why it went the
-- other way.
--
-- **Nullable on purpose, and the null is a third state.** "Not yet asked" and
-- "asked, and the answer was keep them" are different facts about a card: the
-- first prompts, the second must never prompt again. A `NOT NULL DEFAULT 0`
-- would collapse them and re-ask a user who already said no.
ALTER TABLE account ADD COLUMN exclude_settlements_from_stats INTEGER;

CREATE TABLE card_settlement_link (
  id                  TEXT PRIMARY KEY NOT NULL,
  -- The settlement row in the bank account.
  bank_transaction_id TEXT NOT NULL REFERENCES "transaction" (id),
  -- The card it pays. Matched by the last-4 in the row's description — read
  -- from `merchant_raw`, never from `merchant_normalized`, which has had the
  -- digits stripped off it as a branch number (D-060).
  card_account_id     TEXT NOT NULL REFERENCES account (id),
  -- `YYYY-MM`, or null when no statement's total agreed. Not guessed from the
  -- charge date: it is whichever of that card's monthly totals the settlement
  -- equals, which is the same comparison that raises the confidence.
  billing_period      TEXT,
  match_confidence    TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (
                        match_confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  -- `PENDING` is not a third opinion, it is the absence of one. A link exists
  -- from the moment the match is committed, so the home dashboard's nudge and
  -- the account screen both have a row to count, and the prompt can be answered
  -- later or reversed.
  user_decision       TEXT NOT NULL DEFAULT 'PENDING' CHECK (
                        user_decision IN ('EXCLUDED', 'KEPT', 'PENDING')),
  created_at          INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL DEFAULT 0,
  deleted_at          INTEGER
);

-- One link per bank row, among the living. A bank row settles one card; two
-- links would mean two answers about the same money, and the sync that runs on
-- every import has to have something to upsert against.
--
-- Partial on `deleted_at IS NULL` for the reason `transaction_natural_key` is:
-- SQLite treats NULLs in a unique index as distinct, so unique-among-the-living
-- has to be spelled out.
CREATE UNIQUE INDEX card_settlement_link_row
  ON card_settlement_link (bank_transaction_id)
  WHERE deleted_at IS NULL;

-- "What is still unanswered for this card", which is what the prompt and the
-- account screen both ask, and "which of this card's periods are settled",
-- which is the drilldown.
CREATE INDEX card_settlement_link_card
  ON card_settlement_link (card_account_id, billing_period);

-- **The invariant is the repository's, not the schema's.** docs/04: when
-- `user_decision = 'EXCLUDED'` the bank transaction has
-- `is_excluded_from_stats = 1`. It spans two tables, so no CHECK can hold it and
-- a trigger would hide the write from the code that thinks it made it. One
-- function writes both — `setSettlementDecision` — for the same reason
-- `fixedExpenseBasis` is one function: a rule enforced in one place is a rule,
-- and a rule enforced by convention in several is a bug waiting for the fourth
-- caller.
