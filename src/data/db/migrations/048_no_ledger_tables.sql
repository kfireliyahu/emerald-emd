-- 048_no_ledger_tables — the ledger keeps no table of its own. See
-- docs/04-data-model.md, D-214, D-276 and M25 U8.
--
-- Numbered and immutable after release (D-020).
--
-- **The engine's finish line, as a migration.** Every table migrations 001-031
-- made for the ledger has been replaced by a format the ledger pack declares
-- (M25 U1-U8), and a document that keeps a ledger keeps it in those — `fmt_`
-- tables the engine compiles, rows the pack's code writes through the engine.
-- What is left of the old schema is dropped here, with whatever it holds: no
-- row is carried (D-276), and every unit since U3b dropped its group on open
-- the same way. A new document runs 001-047 and then this, so it never keeps
-- one either — and the finish-line test holds a document to that: no table
-- that is neither `fmt_` nor the engine's own.
--
-- Children before the tables they point at, so the order is right even under a
-- `PRAGMA foreign_keys = ON` this app never sets (D-067). `IF EXISTS` because
-- a document converted by M25's builds has already lost most of them on open.

DROP TABLE IF EXISTS reapply_change;
DROP TABLE IF EXISTS reapply_run;
DROP TABLE IF EXISTS category_override;
DROP TABLE IF EXISTS card_settlement_link;
DROP TABLE IF EXISTS staged_row;
DROP TABLE IF EXISTS security_trade;
DROP TABLE IF EXISTS security_position;
DROP TABLE IF EXISTS security_price;
DROP TABLE IF EXISTS purchase_plan;
DROP TABLE IF EXISTS saving_deposit;
DROP TABLE IF EXISTS debt_payment;
DROP TABLE IF EXISTS fund_deposit;
DROP TABLE IF EXISTS fund_balance_snapshot;
DROP TABLE IF EXISTS allocation;
DROP TABLE IF EXISTS split_bucket;
DROP TABLE IF EXISTS split_plan;
DROP TABLE IF EXISTS fixed_expense;
DROP TABLE IF EXISTS paycheck_line;
DROP TABLE IF EXISTS paycheck;
DROP TABLE IF EXISTS deduction_type;
DROP TABLE IF EXISTS saving_goal;
DROP TABLE IF EXISTS debt;
DROP TABLE IF EXISTS fund_account;
DROP TABLE IF EXISTS "transaction";
DROP TABLE IF EXISTS import_session;
DROP TABLE IF EXISTS import_mapping;
DROP TABLE IF EXISTS holding;
DROP TABLE IF EXISTS security;
DROP TABLE IF EXISTS holding_place;
DROP TABLE IF EXISTS fx_rate;
DROP TABLE IF EXISTS category_rule;
DROP TABLE IF EXISTS category;
DROP TABLE IF EXISTS category_group;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS institution;
DROP TABLE IF EXISTS document_template;
DROP TABLE IF EXISTS column_role;
DROP TABLE IF EXISTS app_setting;
