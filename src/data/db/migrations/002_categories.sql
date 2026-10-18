-- 002_categories — the user's own taxonomy, plus the columns that attach it to
-- a transaction. See docs/f02-category-system.md.
--
-- Seed rows use stable, readable ids rather than generated UUIDs. Domain-side
-- UUIDs (docs/04) are for records the user creates; a shipped seed needs a
-- fixed identity so re-seeding is a no-op and so a later migration can point at
-- one without a lookup.

CREATE TABLE category_group (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  color       TEXT
);

CREATE TABLE category (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES category (id),
  group_id      TEXT REFERENCES category_group (id),
  kind          TEXT NOT NULL CHECK (kind IN ('EXPENSE', 'INCOME', 'TRANSFER', 'SAVING', 'DEBT_PAYMENT')),
  color         TEXT,
  icon          TEXT,
  -- Uncategorized and Internal Transfer cannot be deleted; everything else can.
  is_system     INTEGER NOT NULL DEFAULT 0,
  monthly_target_minor INTEGER,
  monthly_target_currency TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_archived   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER
);

CREATE INDEX category_parent ON category (parent_id);

-- Depth is capped at two levels: a category with a parent may not itself be a
-- parent. Deeper trees make every picker and every chart worse (docs/f02).
CREATE TRIGGER category_max_depth_insert
BEFORE INSERT ON category
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM category WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Categories nest two levels at most');
END;

ALTER TABLE "transaction" ADD COLUMN category_id TEXT REFERENCES category (id);
-- MANUAL survives everything: re-import, re-apply rules, AI. D-009.
ALTER TABLE "transaction" ADD COLUMN category_source TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "transaction" ADD COLUMN matched_rule_id TEXT;

CREATE INDEX transaction_category ON "transaction" (category_id);

INSERT INTO category_group (id, name, sort_order) VALUES
  ('grp:living',      'Living',      10),
  ('grp:transport',   'Transport',   20),
  ('grp:lifestyle',   'Lifestyle',   30),
  ('grp:health',      'Health',      40),
  ('grp:family',      'Family',      50),
  ('grp:obligations', 'Obligations', 60),
  ('grp:income',      'Income',      70),
  ('grp:savings',     'Savings',     80),
  ('grp:system',      'System',      90);

-- Top-level categories.
INSERT INTO category (id, name, parent_id, group_id, kind, is_system, sort_order) VALUES
  ('cat:rent',           'Housing & Rent',        NULL, 'grp:living',      'EXPENSE', 0, 10),
  ('cat:mortgage',       'Mortgage',              NULL, 'grp:living',      'EXPENSE', 0, 20),
  ('cat:utilities',      'Utilities',             NULL, 'grp:living',      'EXPENSE', 0, 30),
  ('cat:municipal',      'Municipal tax',         NULL, 'grp:living',      'EXPENSE', 0, 40),
  ('cat:connectivity',   'Internet & Mobile',     NULL, 'grp:living',      'EXPENSE', 0, 50),
  ('cat:groceries',      'Groceries',             NULL, 'grp:living',      'EXPENSE', 0, 60),
  ('cat:insurance',      'Insurance',             NULL, 'grp:living',      'EXPENSE', 0, 70),

  ('cat:fuel',           'Fuel',                  NULL, 'grp:transport',   'EXPENSE', 0, 10),
  ('cat:transit',        'Public transport',      NULL, 'grp:transport',   'EXPENSE', 0, 20),
  ('cat:car',            'Car maintenance',       NULL, 'grp:transport',   'EXPENSE', 0, 30),
  ('cat:parking',        'Parking',               NULL, 'grp:transport',   'EXPENSE', 0, 40),
  ('cat:tolls',          'Tolls',                 NULL, 'grp:transport',   'EXPENSE', 0, 50),

  ('cat:restaurants',    'Restaurants & Cafes',   NULL, 'grp:lifestyle',   'EXPENSE', 0, 10),
  ('cat:entertainment',  'Entertainment',         NULL, 'grp:lifestyle',   'EXPENSE', 0, 20),
  ('cat:shopping',       'Shopping & Clothing',   NULL, 'grp:lifestyle',   'EXPENSE', 0, 30),
  ('cat:travel',         'Travel',                NULL, 'grp:lifestyle',   'EXPENSE', 0, 40),
  ('cat:gifts',          'Gifts',                 NULL, 'grp:lifestyle',   'EXPENSE', 0, 50),
  ('cat:subscriptions',  'Subscriptions',         NULL, 'grp:lifestyle',   'EXPENSE', 0, 60),

  ('cat:pharmacy',       'Pharmacy',              NULL, 'grp:health',      'EXPENSE', 0, 10),
  ('cat:doctors',        'Doctors',               NULL, 'grp:health',      'EXPENSE', 0, 20),
  ('cat:dental',         'Dental',                NULL, 'grp:health',      'EXPENSE', 0, 30),
  ('cat:fitness',        'Fitness',               NULL, 'grp:health',      'EXPENSE', 0, 40),

  ('cat:childcare',      'Childcare',             NULL, 'grp:family',      'EXPENSE', 0, 10),
  ('cat:education',      'Education',             NULL, 'grp:family',      'EXPENSE', 0, 20),
  ('cat:pets',           'Pets',                  NULL, 'grp:family',      'EXPENSE', 0, 30),

  ('cat:loans',          'Loan payments',         NULL, 'grp:obligations', 'DEBT_PAYMENT', 0, 10),
  ('cat:cardfees',       'Credit card fees',      NULL, 'grp:obligations', 'EXPENSE', 0, 20),
  ('cat:bankfees',       'Bank fees',             NULL, 'grp:obligations', 'EXPENSE', 0, 30),
  ('cat:taxes',          'Taxes',                 NULL, 'grp:obligations', 'EXPENSE', 0, 40),

  ('cat:salary',         'Salary',                NULL, 'grp:income',      'INCOME', 0, 10),
  ('cat:bonus',          'Bonus',                 NULL, 'grp:income',      'INCOME', 0, 20),
  ('cat:refunds',        'Refunds',               NULL, 'grp:income',      'INCOME', 0, 30),
  ('cat:interest',       'Interest',              NULL, 'grp:income',      'INCOME', 0, 40),
  ('cat:otherincome',    'Other income',          NULL, 'grp:income',      'INCOME', 0, 50),

  ('cat:pension',        'Pension',               NULL, 'grp:savings',     'SAVING', 0, 10),
  ('cat:studyfund',      'Study fund',            NULL, 'grp:savings',     'SAVING', 0, 20),
  ('cat:investments',    'Investments',           NULL, 'grp:savings',     'SAVING', 0, 30),
  ('cat:emergency',      'Emergency fund',        NULL, 'grp:savings',     'SAVING', 0, 40),

  ('cat:uncategorized',  'Uncategorized',         NULL, 'grp:system',      'EXPENSE',  1, 10),
  ('cat:transfer',       'Internal Transfer',     NULL, 'grp:system',      'TRANSFER', 1, 20);

-- Subcategories. Inserted after their parents so the depth trigger can see them.
INSERT INTO category (id, name, parent_id, group_id, kind, is_system, sort_order) VALUES
  ('cat:electricity',    'Electricity', 'cat:utilities', 'grp:living', 'EXPENSE', 0, 10),
  ('cat:water',          'Water',       'cat:utilities', 'grp:living', 'EXPENSE', 0, 20),
  ('cat:gas',            'Gas',         'cat:utilities', 'grp:living', 'EXPENSE', 0, 30),
  ('cat:healthins',      'Health',      'cat:insurance', 'grp:living', 'EXPENSE', 0, 10),
  ('cat:homeins',        'Home',        'cat:insurance', 'grp:living', 'EXPENSE', 0, 20),
  ('cat:carins',         'Car',         'cat:insurance', 'grp:living', 'EXPENSE', 0, 30);
