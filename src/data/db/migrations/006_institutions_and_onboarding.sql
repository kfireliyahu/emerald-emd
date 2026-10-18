-- 006_institutions_and_onboarding — the records onboarding needs before it can
-- create anything: who the money is with, and how far the user got.
--
-- Numbered and immutable after release (D-020). See docs/f12-onboarding.md.
--
-- Seed rows carry stable readable ids, exactly as 002 does for categories: a
-- shipped row needs a fixed identity so re-seeding is a no-op and so a later
-- migration can point at one without a lookup. Anything the user adds through
-- "other" gets a generated id and `is_user_created = 1`.

CREATE TABLE institution (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (
                      kind IN ('CARD_ISSUER', 'BANK', 'INVESTMENT_PLATFORM', 'FUND_MANAGER', 'OTHER')
                    ),
  -- JSON array. Hebrew and English, former names included: Leumi Card became
  -- Max, and a statement that still says the old name has to find the same row.
  aliases           TEXT NOT NULL DEFAULT '[]',
  color             TEXT,
  is_user_created   INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

-- Display and matching only, never a constraint: docs/04 is explicit that an
-- account can exist with no institution, which is what every account created by
-- an import before this migration has.
ALTER TABLE account ADD COLUMN institution_id TEXT REFERENCES institution (id);

-- The two single-row records docs/04 "Cross-cutting" calls for — onboarding
-- state and settings — as one key/value table rather than one table each. See
-- D-034: a document-level record whose fields are decided by the feature that
-- owns them is a value, not a schema.
CREATE TABLE app_setting (
  key         TEXT PRIMARY KEY NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO institution (id, name, kind, aliases, sort_order) VALUES
  ('inst:cal',        'Cal',                    'CARD_ISSUER', '["כאל","כ.א.ל","ויזה כאל","Visa Cal","CAL"]', 10),
  ('inst:max',        'Max',                    'CARD_ISSUER', '["מקס","מקס איט","לאומי קארד","Leumi Card","max"]', 20),
  ('inst:isracard',   'Isracard',               'CARD_ISSUER', '["ישראכרט","ישראכארט","Isracard"]', 30),
  ('inst:amex',       'American Express',        'CARD_ISSUER', '["אמריקן אקספרס","אמקס","Amex","American Express Israel"]', 40),
  ('inst:diners',     'Diners Club',             'CARD_ISSUER', '["דיינרס","דיינרס קלאב","Diners"]', 50),

  ('inst:hapoalim',   'Bank Hapoalim',          'BANK', '["בנק הפועלים","הפועלים","Poalim","Hapoalim"]', 10),
  ('inst:leumi',      'Bank Leumi',             'BANK', '["בנק לאומי","לאומי","Leumi"]', 20),
  ('inst:discount',   'Israel Discount Bank',   'BANK', '["בנק דיסקונט","דיסקונט","Discount"]', 30),
  ('inst:mizrahi',    'Mizrahi-Tefahot',        'BANK', '["מזרחי טפחות","בנק מזרחי","מזרחי","Mizrahi","Tefahot"]', 40),
  ('inst:beinleumi',  'First International Bank', 'BANK', '["הבינלאומי","בנק הבינלאומי","FIBI","Beinleumi"]', 50),
  ('inst:yahav',      'Bank Yahav',             'BANK', '["בנק יהב","יהב","Yahav"]', 60),
  ('inst:massad',     'Bank Massad',            'BANK', '["בנק מסד","מסד","Massad"]', 70),
  ('inst:jerusalem',  'Bank of Jerusalem',      'BANK', '["בנק ירושלים","ירושלים","Jerusalem"]', 80),
  ('inst:onezero',    'One Zero',               'BANK', '["וואן זירו","One Zero","ONE ZERO"]', 90),

  ('inst:ibi',        'IBI',                    'INVESTMENT_PLATFORM', '["אי.בי.אי","איביאי","IBI Trade"]', 10),
  ('inst:meitav',     'Meitav',                 'INVESTMENT_PLATFORM', '["מיטב","מיטב טרייד","Meitav Trade","Blink"]', 20),
  ('inst:excellence', 'Excellence',             'INVESTMENT_PLATFORM', '["אקסלנס","Excellence Nessuah"]', 30),
  ('inst:psagot',     'Psagot',                 'INVESTMENT_PLATFORM', '["פסגות","Psagot"]', 40),
  ('inst:ibkr',       'Interactive Brokers',    'INVESTMENT_PLATFORM', '["אינטראקטיב ברוקרס","IBKR"]', 50),
  ('inst:etoro',      'eToro',                  'INVESTMENT_PLATFORM', '["איטורו","eToro"]', 60),

  ('inst:menora',     'Menora Mivtachim',       'FUND_MANAGER', '["מנורה מבטחים","מנורה","Menora"]', 10),
  ('inst:migdal',     'Migdal',                 'FUND_MANAGER', '["מגדל","מגדל ביטוח","Migdal"]', 20),
  ('inst:clal',       'Clal Insurance',         'FUND_MANAGER', '["כלל ביטוח","כלל","Clal"]', 30),
  ('inst:harel',      'Harel',                  'FUND_MANAGER', '["הראל","הראל ביטוח","Harel"]', 40),
  ('inst:phoenix',    'The Phoenix',            'FUND_MANAGER', '["הפניקס","Phoenix"]', 50),
  ('inst:altshuler',  'Altshuler Shaham',       'FUND_MANAGER', '["אלטשולר שחם","אלטשולר","Altshuler"]', 60),
  ('inst:yelin',      'Yelin Lapidot',          'FUND_MANAGER', '["ילין לפידות","Yelin"]', 70),
  ('inst:more',       'More',                   'FUND_MANAGER', '["מור","מור גמל","More"]', 80);
