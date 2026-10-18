import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { createDatabase, migrate, query, readSchemaVersion, SCHEMA_VERSION } from './database.ts'

/**
 * The migration walk — M6.5's line that carries the milestone.
 *
 * `database.test.ts` already proves that a *new* database reaches the current
 * schema, that re-running is a no-op, that a file from the future is refused,
 * and that migration 019 does not lose the row it rebuilds around. What none of
 * that covers is the shape that actually costs a user their data: **an empty
 * database cannot lose anything**, so 0→20 shows the SQL parses and no more.
 *
 * Why this is the one failure the app cannot walk back: D-021 made the file the
 * backup and the app the only thing that writes it, so there is no server, no
 * snapshot and no restore. `migrate()` runs, a column goes NULL for every
 * existing row, the file saves, it still opens, and nothing anywhere says so.
 *
 * So the test seeds a row into every table **at the version that first makes
 * the insert legal**, walks the document all the way to current, and reads each
 * one back. A row written by the v1 build survives nineteen migrations or this
 * fails.
 *
 * **Adding a migration means adding a `SEEDS` row for anything it creates**,
 * and — if it rebuilds a table rather than adding a column — a targeted test
 * beside 019's, which is the shape that silently drops data.
 */

type Seed = {
  /** The first schema version at which this insert is legal. */
  readonly version: number
  readonly table: string
  /** The primary key column, for reading the row back. */
  readonly key: string
  readonly id: string
  readonly insert: string
  /** Columns whose values must come back verbatim, however far the walk goes. */
  readonly survives: Readonly<Record<string, string | number | null>>
}

/**
 * Deliberately hand-written rather than generated from `PRAGMA table_info`.
 * Generated values would satisfy the constraints and mean nothing; these are
 * what a real document holds — Hebrew merchant text, minor units, date-only
 * strings — which is what has to come back byte for byte.
 */
const SEEDS: readonly Seed[] = [
  {
    version: 1,
    table: 'account',
    key: 'id',
    id: 'acc-1',
    insert: `INSERT INTO account (id, name, kind, last4, created_at, updated_at)
             VALUES ('acc-1', 'כאל 4821', 'CREDIT_CARD', '4821', 100, 100)`,
    survives: { name: 'כאל 4821', kind: 'CREDIT_CARD', last4: '4821', created_at: 100 },
  },
  {
    version: 1,
    table: 'import_mapping',
    key: 'id',
    id: 'map-1',
    insert: `INSERT INTO import_mapping (id, name, account_id, header_signature, header_row_index,
                                         data_start_row_index, column_roles, amount_convention,
                                         date_orders, default_currency, created_at, updated_at)
             VALUES ('map-1', 'Cal xlsx', 'acc-1', 'תאריך|שם בית העסק|סכום', 3, 4,
                     '{"0":"transactionDate","1":"merchant","2":"amount"}', 'NEGATIVE_IS_OUTFLOW',
                     '["DMY"]', 'ILS', 100, 100)`,
    survives: {
      header_signature: 'תאריך|שם בית העסק|סכום',
      header_row_index: 3,
      column_roles: '{"0":"transactionDate","1":"merchant","2":"amount"}',
      default_currency: 'ILS',
    },
  },
  {
    version: 1,
    table: 'import_session',
    key: 'id',
    id: 'sess-1',
    insert: `INSERT INTO import_session (id, account_id, mapping_id, file_name, file_hash,
                                         row_count_total, status, created_at, updated_at)
             VALUES ('sess-1', 'acc-1', 'map-1', 'cal-2026-08.xlsx', 'sha256:abc', 42,
                     'COMMITTED', 100, 100)`,
    survives: { file_name: 'cal-2026-08.xlsx', file_hash: 'sha256:abc', row_count_total: 42 },
  },
  {
    version: 1,
    table: 'transaction',
    key: 'id',
    id: 'tx-1',
    insert: `INSERT INTO "transaction" (id, account_id, transaction_date, charge_date,
                                        billing_period, amount_minor, currency, direction,
                                        merchant_raw, merchant_normalized, provider_category,
                                        card_last4, installment_sequence, installment_total,
                                        natural_key, import_session_id, source_row_ref,
                                        created_at, updated_at)
             VALUES ('tx-1', 'acc-1', '2026-07-03', '2026-08-02', '2026-08', -42105, 'ILS',
                     'OUTFLOW', 'שופרסל דיל 344', 'שופרסל דיל', 'מזון וצריכה', '4821', 1, 3,
                     'key-1', 'sess-1', 'עסקאות!10', 100, 100)`,
    survives: {
      transaction_date: '2026-07-03',
      charge_date: '2026-08-02',
      amount_minor: -42105,
      currency: 'ILS',
      direction: 'OUTFLOW',
      merchant_raw: 'שופרסל דיל 344',
      merchant_normalized: 'שופרסל דיל',
      provider_category: 'מזון וצריכה',
      installment_sequence: 1,
      installment_total: 3,
      natural_key: 'key-1',
      source_row_ref: 'עסקאות!10',
    },
  },
  {
    version: 2,
    table: 'category_group',
    key: 'id',
    id: 'grp-mine',
    insert: `INSERT INTO category_group (id, name, sort_order, color)
             VALUES ('grp-mine', 'Mine', 5, 'sage')`,
    survives: { name: 'Mine', sort_order: 5, color: 'sage' },
  },
  {
    version: 2,
    table: 'category',
    key: 'id',
    id: 'cat-mine',
    insert: `INSERT INTO category (id, name, group_id, kind, monthly_target_minor,
                                   monthly_target_currency, created_at, updated_at)
             VALUES ('cat-mine', 'סופרמרקט', 'grp-mine', 'EXPENSE', 250000, 'ILS', 100, 100)`,
    survives: {
      name: 'סופרמרקט',
      group_id: 'grp-mine',
      kind: 'EXPENSE',
      monthly_target_minor: 250000,
      monthly_target_currency: 'ILS',
    },
  },
  {
    version: 3,
    table: 'staged_row',
    key: 'id',
    id: 'staged-1',
    insert: `INSERT INTO staged_row (id, session_id, row_index, raw_cells, status, user_decision,
                                     amount_minor, currency, direction, merchant_raw, natural_key,
                                     created_at, updated_at)
             VALUES ('staged-1', 'sess-1', 10, '["03/07/2026","שופרסל דיל 344","-421.05"]',
                     'NEW', 'ACCEPT', -42105, 'ILS', 'OUTFLOW', 'שופרסל דיל 344', 'key-1', 100, 100)`,
    survives: {
      row_index: 10,
      raw_cells: '["03/07/2026","שופרסל דיל 344","-421.05"]',
      status: 'NEW',
      user_decision: 'ACCEPT',
      amount_minor: -42105,
    },
  },
  {
    version: 6,
    table: 'institution',
    key: 'id',
    id: 'inst-mine',
    insert: `INSERT INTO institution (id, name, kind, aliases, is_user_created)
             VALUES ('inst-mine', 'בנק הפועלים', 'BANK', '["הפועלים","Poalim"]', 1)`,
    survives: {
      name: 'בנק הפועלים',
      kind: 'BANK',
      aliases: '["הפועלים","Poalim"]',
      is_user_created: 1,
    },
  },
  {
    version: 6,
    table: 'app_setting',
    key: 'key',
    id: 'onboarding.step',
    insert: `INSERT INTO app_setting (key, value, updated_at) VALUES ('onboarding.step', '4', 100)`,
    survives: { value: '4', updated_at: 100 },
  },
  {
    version: 8,
    table: 'category_rule',
    key: 'id',
    id: 'rule-1',
    insert: `INSERT INTO category_rule (id, name, kind, pattern, target_category_id, priority,
                                        origin, hit_count, created_at, updated_at)
             VALUES ('rule-1', 'Shufersal', 'CONTAINS', 'שופרסל', 'cat-mine', 50,
                     'LEARNED_FROM_CORRECTION', 17, 100, 100)`,
    survives: {
      kind: 'CONTAINS',
      pattern: 'שופרסל',
      target_category_id: 'cat-mine',
      priority: 50,
      origin: 'LEARNED_FROM_CORRECTION',
      hit_count: 17,
    },
  },
  {
    version: 10,
    table: 'category_override',
    key: 'id',
    id: 'ovr-1',
    insert: `INSERT INTO category_override (id, transaction_id, previous_category_id,
                                            previous_source, new_category_id, created_at)
             VALUES ('ovr-1', 'tx-1', 'cat:rent', 'RULE', 'cat-mine', 100)`,
    survives: { transaction_id: 'tx-1', previous_category_id: 'cat:rent', previous_source: 'RULE' },
  },
  {
    version: 11,
    table: 'reapply_run',
    key: 'id',
    id: 'run-1',
    insert: `INSERT INTO reapply_run (id, scope, changed_count, created_at)
             VALUES ('run-1', 'ALL', 9, 100)`,
    survives: { scope: 'ALL', changed_count: 9 },
  },
  {
    version: 11,
    table: 'reapply_change',
    key: 'run_id',
    id: 'run-1',
    insert: `INSERT INTO reapply_change (run_id, transaction_id, previous_category_id,
                                         previous_source, previous_rule_id)
             VALUES ('run-1', 'tx-1', 'cat:rent', 'RULE', 'rule-1')`,
    survives: { transaction_id: 'tx-1', previous_source: 'RULE', previous_rule_id: 'rule-1' },
  },
  {
    version: 12,
    table: 'deduction_type',
    key: 'id',
    id: 'ded-mine',
    insert: `INSERT INTO deduction_type (id, name, hebrew_name, kind, reduces_net, counts_as_saving)
             VALUES ('ded-mine', 'Study fund', 'קרן השתלמות', 'STUDY_FUND', 1, 1)`,
    survives: {
      hebrew_name: 'קרן השתלמות',
      kind: 'STUDY_FUND',
      reduces_net: 1,
      counts_as_saving: 1,
    },
  },
  {
    version: 12,
    table: 'paycheck',
    key: 'id',
    id: 'pay-1',
    insert: `INSERT INTO paycheck (id, period, payment_date, employer_name, gross_minor, net_minor,
                                   currency, deposited_to_account_id, created_at, updated_at)
             VALUES ('pay-1', '2026-06', '2026-07-01', 'מעסיק בעמ', 2850000, 1964250, 'ILS',
                     'acc-1', 100, 100)`,
    survives: {
      period: '2026-06',
      payment_date: '2026-07-01',
      employer_name: 'מעסיק בעמ',
      gross_minor: 2850000,
      net_minor: 1964250,
    },
  },
  {
    version: 12,
    table: 'paycheck_line',
    key: 'id',
    id: 'line-1',
    insert: `INSERT INTO paycheck_line (id, paycheck_id, deduction_type_id, employee_minor,
                                        employer_minor, basis_minor, created_at, updated_at)
             VALUES ('line-1', 'pay-1', 'ded-mine', 71250, 213750, 2850000, 100, 100)`,
    survives: {
      paycheck_id: 'pay-1',
      deduction_type_id: 'ded-mine',
      employee_minor: 71250,
      employer_minor: 213750,
      basis_minor: 2850000,
    },
  },
  {
    version: 13,
    table: 'fixed_expense',
    key: 'id',
    id: 'fix-1',
    insert: `INSERT INTO fixed_expense (id, name, category_id, match_kind, match_ref,
                                        expected_minor, currency, cadence, day_of_month_hint,
                                        source, created_at, updated_at)
             VALUES ('fix-1', 'הוט', 'cat-mine', 'MERCHANT_PATTERN', 'הוט', -19900, 'ILS',
                     'MONTHLY', 12, 'DETECTED_CONFIRMED', 100, 100)`,
    survives: {
      name: 'הוט',
      match_kind: 'MERCHANT_PATTERN',
      match_ref: 'הוט',
      expected_minor: -19900,
      cadence: 'MONTHLY',
      day_of_month_hint: 12,
      source: 'DETECTED_CONFIRMED',
    },
  },
  {
    version: 14,
    table: 'split_plan',
    key: 'id',
    id: 'plan-1',
    insert: `INSERT INTO split_plan (id, name, basis_kind, basis_paycheck_id, currency,
                                     fixed_expense_mode, is_default, applied_to_period,
                                     created_at, updated_at)
             VALUES ('plan-1', 'Monthly', 'SPECIFIC_PAYCHECK', 'pay-1', 'ILS', 'CONFIRMED_ONLY',
                     1, '2026-07', 100, 100)`,
    survives: {
      basis_kind: 'SPECIFIC_PAYCHECK',
      basis_paycheck_id: 'pay-1',
      fixed_expense_mode: 'CONFIRMED_ONLY',
      is_default: 1,
      applied_to_period: '2026-07',
    },
  },
  {
    version: 14,
    table: 'split_bucket',
    key: 'id',
    id: 'bucket-1',
    insert: `INSERT INTO split_bucket (id, name, target_kind, target_id, sort_order,
                                       created_at, updated_at)
             VALUES ('bucket-1', 'Groceries', 'CATEGORY', 'cat-mine', 20, 100, 100)`,
    survives: { name: 'Groceries', target_kind: 'CATEGORY', target_id: 'cat-mine', sort_order: 20 },
  },
  {
    version: 14,
    table: 'allocation',
    key: 'id',
    id: 'alloc-1',
    insert: `INSERT INTO allocation (id, plan_id, bucket_id, mode, basis_points, is_locked,
                                     created_at, updated_at)
             VALUES ('alloc-1', 'plan-1', 'bucket-1', 'PERCENTAGE', 1500, 1, 100, 100)`,
    survives: {
      plan_id: 'plan-1',
      bucket_id: 'bucket-1',
      mode: 'PERCENTAGE',
      basis_points: 1500,
      is_locked: 1,
    },
  },
  {
    version: 15,
    table: 'card_settlement_link',
    key: 'id',
    id: 'link-1',
    insert: `INSERT INTO card_settlement_link (id, bank_transaction_id, card_account_id,
                                               billing_period, match_confidence, user_decision,
                                               created_at, updated_at)
             VALUES ('link-1', 'tx-1', 'acc-1', '2026-08', 'HIGH', 'EXCLUDED', 100, 100)`,
    survives: {
      bank_transaction_id: 'tx-1',
      card_account_id: 'acc-1',
      billing_period: '2026-08',
      match_confidence: 'HIGH',
      user_decision: 'EXCLUDED',
    },
  },
  {
    version: 17,
    table: 'fund_account',
    key: 'id',
    id: 'fund-1',
    insert: `INSERT INTO fund_account (id, name, fund_type, institution_id, policy_number, status,
                                       employer_name, fee_on_accumulation_bp, fee_on_deposit_bp,
                                       created_at, updated_at)
             VALUES ('fund-1', 'מנורה מבטחים פנסיה', 'PENSION', 'inst-mine', 'P-99312', 'DORMANT',
                     'מעסיק קודם', 22, 150, 100, 100)`,
    survives: {
      name: 'מנורה מבטחים פנסיה',
      fund_type: 'PENSION',
      policy_number: 'P-99312',
      status: 'DORMANT',
      employer_name: 'מעסיק קודם',
      fee_on_accumulation_bp: 22,
      fee_on_deposit_bp: 150,
    },
  },
  {
    version: 17,
    table: 'fund_balance_snapshot',
    key: 'id',
    id: 'snap-1',
    insert: `INSERT INTO fund_balance_snapshot (id, fund_account_id, as_of_date, currency,
                                                total_balance_minor, employee_minor,
                                                employer_minor, severance_minor,
                                                fees_charged_minor, source,
                                                deposit_gap_acknowledged, created_at, updated_at)
             VALUES ('snap-1', 'fund-1', '2026-06-30', 'ILS', 41250075, 12000000, 18000000,
                     11250075, -48200, 'REPORT_ENTRY', 1, 100, 100)`,
    survives: {
      as_of_date: '2026-06-30',
      total_balance_minor: 41250075,
      severance_minor: 11250075,
      fees_charged_minor: -48200,
      source: 'REPORT_ENTRY',
      deposit_gap_acknowledged: 1,
    },
  },
  {
    version: 18,
    table: 'holding_place',
    key: 'id',
    id: 'place-1',
    insert: `INSERT INTO holding_place (id, name, kind, institution, is_liquid,
                                        expected_return_bp, expected_return_basis,
                                        created_at, updated_at)
             VALUES ('place-1', 'פיקדון שנתי', 'DEPOSIT', 'בנק הפועלים', 0, 410,
                     'CONTRACTUAL', 100, 100)`,
    // **024 moved three of these columns onto `holding`**, so what survives here
    // is what a place still is: a location. The rate and the liquidity are
    // followed to their new home by the migration's own row, checked in
    // "keeps the rows the migrations seeded themselves" below — which is where
    // the half of 024 that can actually be wrong is proved.
    survives: {
      name: 'פיקדון שנתי',
      kind: 'DEPOSIT',
      institution: 'בנק הפועלים',
    },
  },
  {
    version: 18,
    table: 'saving_goal',
    key: 'id',
    id: 'goal-1',
    insert: `INSERT INTO saving_goal (id, name, kind, target_currency, target_amount_minor,
                                      target_date, default_holding_place_id, priority,
                                      created_at, updated_at)
             VALUES ('goal-1', 'House', 'LONG_TERM', 'ILS', 90000000, '2029-01-01', 'place-1',
                     10, 100, 100)`,
    survives: {
      kind: 'LONG_TERM',
      target_amount_minor: 90000000,
      target_date: '2029-01-01',
      default_holding_id: 'h-place-1',
      priority: 10,
    },
  },
  {
    // The one seed carried through two table *rebuilds* (019 and 024) rather
    // than an ADD COLUMN. `database.test.ts` tests both directly and in detail;
    // this proves the same row also survives the rest of the way to current.
    version: 18,
    table: 'saving_deposit',
    key: 'id',
    id: 'dep-1',
    insert: `INSERT INTO saving_deposit (id, goal_id, date, currency, amount_minor,
                                         holding_place_id, source_kind, source_ref_id, note,
                                         created_at, updated_at)
             VALUES ('dep-1', 'goal-1', '2026-06-01', 'ILS', 250000, 'place-1',
                     'FROM_PAYCHECK_DEDUCTION', 'pay-1:goal-1', 'From the 2026-06 payslip',
                     100, 100)`,
    survives: {
      goal_id: 'goal-1',
      date: '2026-06-01',
      amount_minor: 250000,
      holding_id: 'h-place-1',
      source_kind: 'FROM_PAYCHECK_DEDUCTION',
      source_ref_id: 'pay-1:goal-1',
      note: 'From the 2026-06 payslip',
      created_at: 100,
    },
  },
  {
    // A holding somebody entered themselves, as against the one migration 024
    // derives from `holding_place`. Both matter and they fail differently: this
    // one proves the table carries a user's row forward, and the derived one
    // proves the migration did not move a figure.
    version: 24,
    table: 'holding',
    key: 'id',
    id: 'holding-cash',
    insert: `INSERT INTO holding (id, holding_place_id, name, kind, provenance,
                                  last_confirmed_at, is_liquid, fee_bp, created_at, updated_at)
             VALUES ('holding-cash', 'place-1', 'עו"ש', 'CASH', 'RECORDED', '2026-08-01', 1, 50,
                     100, 100)`,
    survives: {
      holding_place_id: 'place-1',
      name: 'עו"ש',
      kind: 'CASH',
      provenance: 'RECORDED',
      last_confirmed_at: '2026-08-01',
      is_liquid: 1,
      fee_bp: 50,
    },
  },
  {
    version: 20,
    table: 'debt',
    key: 'id',
    id: 'debt-1',
    insert: `INSERT INTO debt (id, name, kind, currency, principal_minor, opened_date,
                               expected_end_date, monthly_payment_minor, linked_account_id,
                               auto_track_kind, auto_track_ref, created_at, updated_at)
             VALUES ('debt-1', 'משכנתא', 'MORTGAGE', 'ILS', 120000000, '2021-03-01', '2046-03-01',
                     -520000, 'acc-1', 'MERCHANT_PATTERN', 'הפועלים משכנתא', 100, 100)`,
    survives: {
      name: 'משכנתא',
      kind: 'MORTGAGE',
      principal_minor: 120000000,
      opened_date: '2021-03-01',
      monthly_payment_minor: -520000,
      auto_track_kind: 'MERCHANT_PATTERN',
      auto_track_ref: 'הפועלים משכנתא',
    },
  },
  {
    version: 20,
    table: 'debt_payment',
    key: 'id',
    id: 'debtpay-1',
    insert: `INSERT INTO debt_payment (id, debt_id, date, currency, amount_minor, interest_minor,
                                       source_kind, source_ref_id, is_confirmed,
                                       created_at, updated_at)
             VALUES ('debtpay-1', 'debt-1', '2026-07-05', 'ILS', -520000, -184300,
                     'TRANSACTION', 'tx-1', 1, 100, 100)`,
    survives: {
      debt_id: 'debt-1',
      date: '2026-07-05',
      amount_minor: -520000,
      interest_minor: -184300,
      source_kind: 'TRANSACTION',
      source_ref_id: 'tx-1',
    },
  },
  {
    version: 21,
    table: 'document_template',
    key: 'id',
    id: 'tpl-1',
    // The signature is assembled in SQL rather than typed: it joins on U+001F,
    // and a control character pasted into a source file is one nobody can see.
    // Hebrew in the anchor, because that is what a real template holds and a
    // walk that mangled it would be invisible in an ASCII fixture.
    insert: `INSERT INTO document_template (id, kind, name, label_signature, anchors, derived_by,
                                            confirmed_at, pinned_fields, version,
                                            created_at, updated_at)
             VALUES ('tpl-1', 'PAYSLIP', 'Software Labs',
                     'lv1' || char(31) || '2' || char(31) || 'ברוטו' || char(31) || 'נטו לתשלום',
                     '{"shape":"payslip","fields":[{"field":"netLine","label":"נטו לתשלום","occurrence":0,"derivedLine":31}],"deductions":[]}',
                     'LOCAL_MODEL', 200, '["netLine"]', 3, 100, 100)`,
    survives: {
      kind: 'PAYSLIP',
      name: 'Software Labs',
      derived_by: 'LOCAL_MODEL',
      confirmed_at: 200,
      pinned_fields: '["netLine"]',
      version: 3,
    },
  },
  {
    version: 22,
    table: 'fund_deposit',
    key: 'id',
    id: 'funddep-1',
    // A row of the deposit table a report prints (D-153), hanging off the
    // snapshot seeded at v17. The salary month is the column that matters and
    // it is a month, not a date: a deposit made on 04/01/2026 **for 11/2025** is
    // late, and a walk that turned it into a day would lose exactly that.
    insert: `INSERT INTO fund_deposit (id, fund_account_id, snapshot_id, employer_name,
                                       deposit_date, salary_month, currency, employee_minor,
                                       employer_minor, severance_minor, salary_minor, source,
                                       created_at, updated_at)
             VALUES ('funddep-1', 'fund-1', 'snap-1', 'מעבדות תוכנה',
                     '2026-01-04', '2025-11', 'ILS', 150000, 175000, 75000, 2000000,
                     'REPORT_ENTRY', 100, 100)`,
    survives: {
      fund_account_id: 'fund-1',
      snapshot_id: 'snap-1',
      employer_name: 'מעבדות תוכנה',
      deposit_date: '2026-01-04',
      salary_month: '2025-11',
      employee_minor: 150000,
      employer_minor: 175000,
      severance_minor: 75000,
      source: 'REPORT_ENTRY',
    },
  },
  {
    version: 25,
    table: 'security',
    key: 'id',
    id: 'sec-1',
    // A TASE security, because the two things most likely to be mangled on the
    // way through a migration are a Hebrew name and a currency that is not the
    // one the price looks like it is in.
    insert: `INSERT INTO security (id, isin, ticker, name, currency, kind, exchange,
                                   created_at, updated_at)
             VALUES ('sec-1', 'IL0010811243', 'TA125', 'ת"א 125', 'ILS', 'ETF', 'TASE', 100, 100)`,
    survives: {
      isin: 'IL0010811243',
      ticker: 'TA125',
      name: 'ת"א 125',
      currency: 'ILS',
      kind: 'ETF',
      exchange: 'TASE',
    },
  },
  {
    version: 25,
    table: 'security_position',
    key: 'holding_id',
    id: 'holding-cash',
    // Keyed on the holding rather than an id of its own (D-181), which is why
    // this seed borrows the holding written at v24 rather than inventing one.
    insert: `INSERT INTO security_position (holding_id, security_id, quantity_micro,
                                            quantity_as_of, created_at, updated_at)
             VALUES ('holding-cash', 'sec-1', 12345000, '2026-06-30', 100, 100)`,
    survives: {
      security_id: 'sec-1',
      quantity_micro: 12345000,
      quantity_as_of: '2026-06-30',
    },
  },
  {
    version: 25,
    table: 'security_price',
    key: 'id',
    id: 'price-1',
    insert: `INSERT INTO security_price (id, security_id, as_of, currency, price_minor,
                                         source, source_detail, created_at, updated_at)
             VALUES ('price-1', 'sec-1', '2026-06-30', 'ILS', 12345, 'TRANSCRIBED',
                     'Q2 statement', 100, 100)`,
    survives: {
      security_id: 'sec-1',
      as_of: '2026-06-30',
      // Seeded as 12345 agorot at v25 and read back at v30's width: migration
      // 030 multiplies by a million and the price still means ₪123.45 (D-204).
      price_micro: 12345000000,
      source: 'TRANSCRIBED',
      source_detail: 'Q2 statement',
    },
  },
  {
    version: 25,
    table: 'security_trade',
    key: 'id',
    id: 'trade-1',
    // With the printed consideration, because that is the column whose whole
    // point is that it survives rather than being recomputed.
    insert: `INSERT INTO security_trade (id, holding_id, security_id, date, side,
                                         quantity_micro, currency, unit_price_minor, fee_minor,
                                         consideration_minor, created_at, updated_at)
             VALUES ('trade-1', 'holding-cash', 'sec-1', '2026-01-15', 'BUY', 10000000,
                     'ILS', 11000, 550, 110550, 100, 100)`,
    survives: {
      holding_id: 'holding-cash',
      security_id: 'sec-1',
      date: '2026-01-15',
      side: 'BUY',
      quantity_micro: 10000000,
      unit_price_micro: 11000000000,
      fee_minor: 550,
      consideration_minor: 110550,
    },
  },
  {
    version: 25,
    table: 'purchase_plan',
    key: 'id',
    id: 'plan-1',
    insert: `INSERT INTO purchase_plan (id, security_id, holding_id, currency, amount_minor,
                                        cadence, start_date, is_active, created_at, updated_at)
             VALUES ('plan-1', 'sec-1', 'holding-cash', 'ILS', 100000, 'MONTHLY',
                     '2026-07-01', 1, 100, 100)`,
    survives: {
      security_id: 'sec-1',
      holding_id: 'holding-cash',
      amount_minor: 100000,
      cadence: 'MONTHLY',
      start_date: '2026-07-01',
      is_active: 1,
    },
  },
  {
    version: 25,
    table: 'fx_rate',
    key: 'id',
    id: 'fx-1',
    insert: `INSERT INTO fx_rate (id, base_currency, quote_currency, as_of, rate_micro,
                                  source, created_at, updated_at)
             VALUES ('fx-1', 'USD', 'ILS', '2026-06-30', 3720000, 'TYPED', 100, 100)`,
    survives: {
      base_currency: 'USD',
      quote_currency: 'ILS',
      as_of: '2026-06-30',
      rate_micro: 3720000,
      source: 'TYPED',
    },
  },
  {
    // **A role somebody added**, which is the half of 031 that has to survive.
    // The seeded forty-six arrive with the migration and would come back even
    // if a later one rebuilt the table from `SEEDED_ROLES`; a `USER` row is the
    // only thing in here that cannot be regenerated, so it is the one worth
    // carrying. This is `cost` under another name (D-208, D-212).
    version: 31,
    table: 'column_role',
    key: 'role',
    id: 'settlementDate',
    insert: `INSERT INTO column_role (vocabulary, role, origin, position, created_at)
             VALUES ('STATEMENT', 'settlementDate', 'USER', 18, 100)`,
    survives: {
      vocabulary: 'STATEMENT',
      origin: 'USER',
      position: 18,
      created_at: 100,
    },
  },
  {
    // **A format the user declared** — the engine's three tables (032, D-216).
    // Every one of these rows is unregenerable by construction: a declaration is
    // the source of truth and nothing in the build knows it existed. The table
    // it compiles to is not seeded here on purpose — `fmt_ingredient` is made by
    // the reconciler from this row rather than by a migration, which is the
    // whole of D-214, and a walk that carried the table but lost the
    // declaration would have the reconciler asking to drop it.
    version: 32,
    table: 'format',
    key: 'name',
    id: 'ingredient',
    insert: `INSERT INTO format (name, title, language, notes, created_at, updated_at)
             VALUES ('ingredient', 'Ingredient', 1, 'Dry weight, which is what recipes measure.', 100, 100)`,
    survives: {
      title: 'Ingredient',
      language: 1,
      notes: 'Dry weight, which is what recipes measure.',
      created_at: 100,
    },
  },
  {
    version: 32,
    table: 'format_column',
    key: 'name',
    id: 'micros_basis',
    insert: `INSERT INTO format_column
               (format_name, name, type, unit, required, minimum, maximum, note, position)
             VALUES ('ingredient', 'micros_basis', 'enum', NULL, 1, NULL, NULL, 'The third state', 0)`,
    survives: {
      format_name: 'ingredient',
      type: 'enum',
      unit: null,
      required: 1,
      note: 'The third state',
      position: 0,
    },
  },
  {
    version: 32,
    table: 'format_column_value',
    key: 'value',
    id: 'analogue',
    insert: `INSERT INTO format_column_value (format_name, column_name, value, position)
             VALUES ('ingredient', 'micros_basis', 'analogue', 1)`,
    survives: {
      format_name: 'ingredient',
      column_name: 'micros_basis',
      position: 1,
    },
  },
  {
    // U3's table (D-222). The expression is stored as it was typed and
    // is never rewritten, so a document that crossed this version keeps the
    // arithmetic it was written with — down to the spaces.
    version: 33,
    table: 'format_identity',
    key: 'name',
    id: 'atwater',
    insert: `INSERT INTO format_identity
               (format_name, name, expression, tolerance_kind, tolerance_amount, note, position)
             VALUES ('ingredient', 'atwater', '4*protein_g = kcal', 'RELATIVE', 2, 'the label rounds', 0)`,
    survives: {
      format_name: 'ingredient',
      expression: '4*protein_g = kcal',
      tolerance_kind: 'RELATIVE',
      tolerance_amount: 2,
      note: 'the label rounds',
      position: 0,
    },
  },
  {
    // **A unit somebody added**, which is the half of 034 that has to survive
    // (D-223). The twenty-eight seeded rows arrive with the migration and would
    // come back even if a later one rebuilt the table; a `USER` row is the only
    // thing here that cannot be regenerated. `slice` is `cost` under a third
    // name (D-208, D-212) — the thing a real document measures in that no build
    // ever shipped a word for.
    version: 34,
    table: 'measurement_unit',
    key: 'symbol',
    id: 'slice',
    insert: `INSERT INTO measurement_unit (symbol, dimension, per_base, origin, note, created_at)
             VALUES ('slice', 'COUNT', 1, 'USER', 'a slice of the loaf I buy', 100)`,
    survives: {
      dimension: 'COUNT',
      per_base: 1,
      origin: 'USER',
      note: 'a slice of the loaf I buy',
      created_at: 100,
    },
  },
  {
    // U4b's table (D-224). An aggregate is unregenerable by construction — it
    // is a thing a person worked out and nothing in the build knows it
    // existed — and it is folded on read, so what has to survive is the
    // declaration and never a figure.
    version: 35,
    table: 'format_aggregate',
    key: 'name',
    id: 'total_kcal',
    insert: `INSERT INTO format_aggregate
               (format_name, name, kind, over_format, over_column, expression, unit, note, position)
             VALUES ('ingredient', 'total_kcal', 'SUM', 'recipe_line', 'recipe',
                     'amount_g / 100 * ingredient.kcal', 'kcal', 'what the dish comes to', 0)`,
    survives: {
      format_name: 'ingredient',
      kind: 'SUM',
      over_format: 'recipe_line',
      over_column: 'recipe',
      expression: 'amount_g / 100 * ingredient.kcal',
      unit: 'kcal',
      note: 'what the dish comes to',
      position: 0,
    },
  },
  {
    // U5's three tables (D-226). What has to survive here is **provenance** —
    // which file wrote which rows — because it is the only thing that can offer
    // to supersede a re-read of the same file, and a document that lost it
    // would start duplicating four hundred rows at a time.
    version: 37,
    table: 'format_intake',
    key: 'id',
    id: 'intake-1',
    insert: `INSERT INTO format_intake
               (id, format_name, file_name, file_hash, signature, header_row, date_order, read_at, row_count)
             VALUES ('intake-1', 'ingredient', 'pantry.xlsx', 'hash-1', 'grams|kcal|name', 0, 'dmy', 1758153600000, 2)`,
    survives: {
      format_name: 'ingredient',
      file_name: 'pantry.xlsx',
      file_hash: 'hash-1',
      signature: 'grams|kcal|name',
      header_row: 0,
      date_order: 'dmy',
      read_at: 1758153600000,
      row_count: 2,
    },
  },
  {
    version: 37,
    table: 'format_intake_column',
    key: 'key_name',
    id: 'kcal',
    insert: `INSERT INTO format_intake_column (intake_id, key_name, source_index, fixed_value)
             VALUES ('intake-1', 'kcal', 2, NULL)`,
    survives: { intake_id: 'intake-1', source_index: 2, fixed_value: null },
  },
  {
    version: 37,
    table: 'format_intake_row',
    key: 'row_id',
    id: 'row-1',
    insert: `INSERT INTO format_intake_row (intake_id, row_id) VALUES ('intake-1', 'row-1')`,
    survives: { intake_id: 'intake-1' },
  },
  {
    // A row constraint is its sentence (D-259), read back through the parser,
    // so what has to survive is the sentence exactly as it was stored.
    version: 40,
    table: 'format_constraint',
    key: 'rule',
    id: 'at most one of a, b',
    insert: `INSERT INTO format_constraint (format_name, rule, note, position)
             VALUES ('ingredient', 'at most one of a, b', 'one source', 0)`,
    survives: { format_name: 'ingredient', rule: 'at most one of a, b', note: 'one source' },
  },
  {
    // A filter is two columns on the aggregate (D-260); both have to come
    // through, or a filtered figure becomes a total over every row.
    version: 41,
    table: 'format_aggregate',
    key: 'name',
    id: 'deducted',
    insert: `INSERT INTO format_aggregate
               (format_name, name, kind, over_format, over_column, expression, position,
                where_column, where_member)
             VALUES ('paycheck', 'deducted', 'SUM', 'paycheck_line', 'paycheck', 'amount', 0,
                     'deduction_type.reduces_net', 'true')`,
    survives: { where_column: 'deduction_type.reduces_net', where_member: 'true' },
  },
  {
    // A header cell is a position (D-262), and a row below zero counts from the
    // end: the sign has to come through, or the total is read off the top.
    version: 42,
    table: 'format_intake_header_cell',
    key: 'key_name',
    id: 'printed_total',
    insert: `INSERT INTO format_intake_header_cell (intake_id, key_name, source_row, source_index)
             VALUES ('intake-1', 'printed_total', -1, 3)`,
    survives: { intake_id: 'intake-1', source_row: -1, source_index: 3 },
  },
  {
    // A removed seed is the one record that must come through (D-264): lost,
    // the pack puts back a row somebody took away.
    version: 43,
    table: 'format_seed',
    key: 'seed_key',
    id: 'Groceries',
    insert: `INSERT INTO format_seed (format_name, seed_key, state)
             VALUES ('category', 'Groceries', 'REMOVED')`,
    survives: { format_name: 'category', state: 'REMOVED' },
  },
  {
    // A rollup is its sentence (D-271), read back through the parser, so the
    // sentence has to come through exactly as it was stored.
    version: 44,
    table: 'format_rollup',
    key: 'name',
    id: 'spending',
    insert: `INSERT INTO format_rollup (format_name, name, works_out, note, position)
             VALUES ('ingredient', 'spending', 'count by month of bought_on', 'per month', 0)`,
    survives: { format_name: 'ingredient', works_out: 'count by month of bought_on', note: 'per month' },
  },
  {
    // The kind's CHECK is rebuilt for two picks (D-272), so the order column
    // has to come through the rebuild with the kind that needs it.
    version: 45,
    table: 'format_aggregate',
    key: 'name',
    id: 'price',
    insert: `INSERT INTO format_aggregate
               (format_name, name, kind, over_format, over_column, expression, position, by_column)
             VALUES ('security', 'price', 'LATEST', 'security_price', 'security', 'price', 0, 'as_of')`,
    survives: { kind: 'LATEST', by_column: 'as_of' },
  },
  {
    // A rule set is its sentence (D-273), read back through the parser.
    version: 46,
    table: 'format_rule_set',
    key: 'name',
    id: 'shelves',
    insert: `INSERT INTO format_rule_set (format_name, name, sets, note, position)
             VALUES ('shelf_rule', 'shelves', 'product.shelf from shelf when label matches pattern as contains first by priority, recorded in shelf_source as RULE, never over PERSON', 'by label', 0)`,
    survives: {
      format_name: 'shelf_rule',
      sets: 'product.shelf from shelf when label matches pattern as contains first by priority, recorded in shelf_source as RULE, never over PERSON',
    },
  },
  {
    // Which pack owns a format (D-269): lost, a pack's rows would open to
    // every generic write again.
    version: 47,
    table: 'format',
    key: 'name',
    id: 'owned',
    insert: `INSERT INTO format (name, title, language, pack, pack_written, pack_columns)
             VALUES ('owned', 'Owned', 13, 'ledger', 'on its own screen', 'name,parent')`,
    survives: { pack: 'ledger', pack_written: 'on its own screen', pack_columns: 'name,parent' },
  },
]

/**
 * The last schema that kept the ledger's own tables. 048 drops every one of
 * them (M25 U8), so what the walk proves about them it proves up to here.
 */
const LAST_WITH_LEDGER_TABLES = 47

/** A document written by the v1 build, carried forward one version at a time. */
async function walkedDocument(to: number = LAST_WITH_LEDGER_TABLES) {
  const db = await createDatabase(1)
  for (const seed of SEEDS) {
    migrate(db, seed.version)
    db.run(seed.insert)
  }
  migrate(db, to)
  return db
}

describe('a document seeded at every version and walked to the current schema', () => {
  it('arrives at the current version', async () => {
    const db = await walkedDocument(SCHEMA_VERSION)
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
  })

  it('keeps no table the ledger made before M25, and every one of the engine’s (048)', async () => {
    const db = await walkedDocument(SCHEMA_VERSION)
    const tables = query(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((row) => String(row['name']))
    expect(tables.filter((name) => name !== 'schema_version' && !name.startsWith('format') && name !== 'measurement_unit' && name !== 'document_setting')).toEqual([])
    // What a person declared is the engine's, and 048 leaves it alone.
    expect(query(db, "SELECT name FROM format WHERE name = 'owned'")).toHaveLength(1)
  })

  it.each(SEEDS.map((seed) => [`${seed.table} (written at v${seed.version})`, seed] as const))(
    'still holds %s, with every value it was given',
    async (_label, seed) => {
      const db = await walkedDocument()
      const rows = query(db, `SELECT * FROM "${seed.table}" WHERE ${seed.key} = ?`, [seed.id])

      expect(rows).toHaveLength(1)
      for (const [column, value] of Object.entries(seed.survives)) {
        expect({ [column]: rows[0]?.[column] }).toEqual({ [column]: value })
      }
    },
  )

  it('keeps the rows the migrations seeded themselves', async () => {
    // 002's taxonomy, 006's institutions and 012's deduction types are written
    // by a migration rather than by the user, and are just as lost if a later
    // migration drops them. The Hebrew ones also prove the walk does not mangle
    // text on the way through.
    const db = await walkedDocument()

    expect(query(db, `SELECT name FROM category WHERE id = 'cat:rent'`)[0]?.['name']).toBe(
      'Housing & Rent',
    )
    expect(query(db, `SELECT aliases FROM institution WHERE id = 'inst:cal'`)[0]?.['aliases']).toBe(
      '["כאל","כ.א.ל","ויזה כאל","Visa Cal","CAL"]',
    )
    expect(
      query(db, `SELECT hebrew_name FROM deduction_type WHERE id = 'ded:income-tax'`)[0]?.[
        'hebrew_name'
      ],
    ).toBe('מס הכנסה')

    // **Migration 024's own row, and the one figure it may not move.** Each
    // place gets exactly one holding carrying what the place used to carry, at
    // `'h-' || place.id` — the id `saving_deposit` and `saving_goal` above are
    // rewritten to point at. A rate or a liquidity that did not come across
    // here is a per-place total, a liquidity subtotal and a projection all
    // quietly different from what the document said yesterday (D-175).
    const derived = query(db, `SELECT * FROM holding WHERE id = 'h-place-1'`)[0]
    expect(derived?.['holding_place_id']).toBe('place-1')
    expect(derived?.['is_liquid']).toBe(0)
    expect(derived?.['expected_return_bp']).toBe(410)
    expect(derived?.['expected_return_basis']).toBe('CONTRACTUAL')
    // Nobody has confirmed anything, and the migration does not pretend they
    // have: `RECORDED` with no date is what was true before it ran (D-176).
    expect(derived?.['provenance']).toBe('RECORDED')
    expect(derived?.['last_confirmed_at']).toBeNull()
  })

  it('has a seed for every table in the schema', async () => {
    // The line that keeps this file honest as the schema grows. A migration
    // that creates a table nobody seeded here would otherwise pass forever
    // without that table ever being carried through a single later migration.
    const db = await createDatabase(LAST_WITH_LEDGER_TABLES)
    const seeded = new Set(SEEDS.map((seed) => seed.table))
    const notADocumentTable = new Set(['schema_version'])

    const unseeded = query(
      db,
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
      .map((row) => String(row['name']))
      .filter((name) => !seeded.has(name) && !notADocumentTable.has(name))

    expect(unseeded).toEqual([])
  })
})

describe('027, which rebuilds a table to widen one vocabulary', () => {
  it('takes FROM_PLAN, which 020 had no word for', async () => {
    const db = await walkedDocument()

    expect(() =>
      db.run(
        `INSERT INTO debt_payment (id, debt_id, date, currency, amount_minor, source_kind,
                                   source_ref_id, is_confirmed, created_at, updated_at)
         VALUES ('plan-pay', 'debt-1', '2026-07-01', 'ILS', 200000, 'FROM_PLAN',
                 'plan-1:2026-07:bucket-1', 1, 0, 0)`,
      ),
    ).not.toThrow()
  })

  it('still refuses a kind nothing spells', async () => {
    const db = await walkedDocument()

    expect(() =>
      db.run(
        `INSERT INTO debt_payment (id, debt_id, date, currency, amount_minor, source_kind,
                                   created_at, updated_at)
         VALUES ('bad-pay', 'debt-1', '2026-07-01', 'ILS', 200000, 'FROM_NOWHERE', 0, 0)`,
      ),
    ).toThrow()
  })

  it('keeps the unique index the rebuild dropped with the table', async () => {
    const db = await walkedDocument()
    const insert = (id: string) =>
      db.run(
        `INSERT INTO debt_payment (id, debt_id, date, currency, amount_minor, source_kind,
                                   source_ref_id, is_confirmed, created_at, updated_at)
         VALUES ('${id}', 'debt-1', '2026-07-01', 'ILS', 200000, 'FROM_PLAN',
                 'plan-1:2026-07:bucket-1', 1, 0, 0)`,
      )

    insert('plan-pay-1')
    // One payment per (debt, kind, ref) — 020's index, recreated verbatim, which
    // is what makes `applyPlanPayment`'s upsert a constraint rather than a habit.
    expect(() => insert('plan-pay-2')).toThrow()
  })
})

describe('028, which gives a security number the column it was missing (D-195)', () => {
  /** A security written before 028, with the TASE number where D-194 left it. */
  const numbered = (db: Database, id: string, ticker: string) =>
    db.run(
      `INSERT INTO security (id, ticker, name, currency, kind, created_at, updated_at)
       VALUES ('${id}', '${ticker}', 'קרן סל', 'ILS', 'OTHER', 100, 100)`,
    )

  it('moves an all-digit ticker into it, so next quarter matches rather than duplicates', async () => {
    const db = await createDatabase(27)
    numbered(db, 'sec-number', '7770001')
    migrate(db, LAST_WITH_LEDGER_TABLES)

    const row = query(db, `SELECT ticker, security_number FROM security WHERE id = 'sec-number'`)[0]
    expect(row?.['security_number']).toBe('7770001')
    // A copy, not a move: nothing here deletes what the user may have typed, and
    // the ticker is what the screen has been printing for a milestone.
    expect(row?.['ticker']).toBe('7770001')
  })

  it('leaves a real ticker alone, because letters are what makes one', async () => {
    // The walked document's own seed: `TA125` is a symbol, not a number.
    const db = await walkedDocument()
    const row = query(db, `SELECT ticker, security_number FROM security WHERE id = 'sec-1'`)[0]
    expect(row?.['ticker']).toBe('TA125')
    expect(row?.['security_number']).toBeNull()
  })

  it('backfills neither of two securities that already share a number', async () => {
    const db = await createDatabase(27)
    numbered(db, 'twin-a', '7770002')
    numbered(db, 'twin-b', '7770002')

    // The duplicate this column exists to prevent, already in the document. A
    // migration that backfilled it would fail the unique index below and the
    // file would stop opening — so it backfills neither and says nothing.
    expect(() => migrate(db, LAST_WITH_LEDGER_TABLES)).not.toThrow()
    const rows = query(db, `SELECT security_number FROM security WHERE ticker = '7770002'`)
    expect(rows.map((row) => row['security_number'])).toEqual([null, null])
  })

  it('holds one row per number, which is what makes it a key', async () => {
    const db = await walkedDocument()
    db.run(
      `INSERT INTO security (id, security_number, name, currency, kind, created_at, updated_at)
       VALUES ('sec-a', '7770003', 'A', 'ILS', 'OTHER', 100, 100)`,
    )

    expect(() =>
      db.run(
        `INSERT INTO security (id, security_number, name, currency, kind, created_at, updated_at)
         VALUES ('sec-b', '7770003', 'B', 'ILS', 'OTHER', 100, 100)`,
      ),
    ).toThrow()
  })

  it('holds any number of securities that have none, because NULL is not a key', async () => {
    const db = await walkedDocument()
    const insert = (id: string) =>
      db.run(
        `INSERT INTO security (id, name, currency, kind, created_at, updated_at)
         VALUES ('${id}', 'Unnumbered', 'USD', 'ETF', 100, 100)`,
      )

    insert('sec-c')
    expect(() => insert('sec-d')).not.toThrow()
  })
})

describe('029, which lets a purchase say what paid for it (D-200)', () => {
  it('leaves every trade written before it unfunded, which is what they are', async () => {
    // The walked document's own seed, written at 25. A column added to a table
    // full of rows is NULL for all of them, and here NULL is the truth: nobody
    // had been asked.
    const db = await walkedDocument()
    const row = query(
      db,
      `SELECT funding_transaction_id FROM security_trade WHERE id = 'trade-1'`,
    )[0]
    expect(row?.['funding_transaction_id']).toBeNull()
  })

  it('lets one transaction pay for several purchases, which is the shape it is for', async () => {
    const db = await walkedDocument()
    const buy = (id: string, date: string) =>
      db.run(
        `INSERT INTO security_trade (id, holding_id, security_id, date, side, quantity_micro,
                                     currency, unit_price_micro, fee_minor,
                                     funding_transaction_id, created_at, updated_at)
         VALUES ('${id}', 'holding-cash', 'sec-1', '${date}', 'BUY', 1000000, 'ILS',
                 11000000000, 0, 'tx-1', 100, 100)`,
      )

    buy('trade-a', '2026-02-02')
    expect(() => buy('trade-b', '2026-02-03')).not.toThrow()

    const rows = query(
      db,
      `SELECT id FROM security_trade WHERE funding_transaction_id = 'tx-1' ORDER BY id`,
    )
    expect(rows.map((row) => row['id'])).toEqual(['trade-a', 'trade-b'])
  })
})
