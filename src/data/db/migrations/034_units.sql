-- 034_units — dimension and conversion become rows the document holds.
-- See docs/04-data-model.md ("Formats"), docs/engine.md (H7) and D-223.
--
-- Numbered and immutable after release (D-020).
--
-- **This is H7, answered by building the smallest version of it.** 032 stored a
-- column's unit and said in the same breath that it was *recorded and not yet
-- interpreted* — the engine owning conversion was U4's decision and this is it:
--
--   > The engine owns dimension and conversion. A factor that crosses a
--   > dimension is a column somebody declared.
--
-- `kg` to `g` is arithmetic, true in every domain, and a pack that rebuilt it
-- would rebuild it badly — which is the `cost`-role bug (D-208) one level up.
-- `ml` to `g` is not arithmetic: it needs a density, and a density is a fact
-- about pasta rather than about volume. So the engine converts inside a
-- dimension and across one it stops and names what it would need, which is a
-- column already kept by hand in the vault this design is specified
-- against (D-210).
--
-- **Why rows and not a `const`, which is D-212's argument with a second half.**
-- The first half is the one the four reading vocabularies already paid for: a
-- vocabulary compiled into the binary cannot name a thing a real document
-- prints, and a user weighing in `oz` or portioning in `slice` would be back at
-- the wall that cost M16 a ₪3,639 discrepancy, with a release as the fix.
--
-- The second half is new here and is the stronger one. **A tablespoon is 15 ml
-- in this build and 20 ml in Australia**; a cup is 240 ml here and 250 ml in a
-- metric kitchen; a fluid ounce is two different volumes on two sides of an
-- ocean. Those are not facts the engine gets to be right about. They are
-- conventions, and a document that records the convention it used can be
-- corrected by the person whose kitchen it is. Every seeded row that is a
-- convention rather than a definition says so in its note, because a person who
-- cannot tell the two apart cannot know which rows they are allowed to change.
--
-- **The list is still closed at the moment it is used** (D-114), exactly as the
-- roles are: a conversion is resolved against these rows rather than against an
-- array in the build. What changes is only that the rows can differ between
-- documents.
--
-- **Nothing here becomes DDL, a CHECK or a trigger.** A unit is read by the
-- identity evaluator, in TypeScript, over numbers — the same discipline D-222
-- set for the equations these units appear in. A declared column's `unit` stays
-- free text and is *not* a foreign key into this table: `per 100g` is a label
-- somebody wrote and refusing it would break every declaration written before
-- today. A unit this table knows converts; one it does not is a label, and an
-- identity asking to convert it says so in a sentence.

CREATE TABLE measurement_unit (
  -- `kg`, `tbsp`, `µg` — as written on a column and after an identity's `in`.
  -- **Case is kept**, because `mg` and `Mg` are a thousandfold apart in every
  -- table that has ever printed both, and a lookup that ignored case would pick
  -- one of them silently.
  symbol     TEXT PRIMARY KEY NOT NULL,
  -- What it measures. **Physics, not food**: the list reaches past the three
  -- dimensions the recipe vault needs precisely so that the engine's unit model
  -- is not shaped by one pack, which is the outcome H7 warns about in its first
  -- paragraph. COUNT is seeded with `each` and nothing else — one clove and one
  -- can are both one thing, and what a clove weighs is the far side of the line
  -- above.
  dimension  TEXT NOT NULL CHECK (dimension IN (
               'MASS', 'VOLUME', 'LENGTH', 'TIME', 'ENERGY', 'COUNT')),
  -- How many of this dimension's base unit one of these is — g, ml, mm, s, kJ,
  -- each. A REAL rather than anything more careful, and that is a considered
  -- limit rather than an oversight: a conversion factor is a ratio of
  -- measurements and not money, and a `money` column carries no unit at all
  -- (`columnRejection` refuses one), so there is no path from this multiply to
  -- an amount. D-003 is untouched.
  per_base   REAL NOT NULL CHECK (per_base > 0),
  -- SEEDED is one this build shipped; USER is one somebody added because they
  -- measure in something this build never heard of. The distinction is what
  -- lets a later build correct a factor it got wrong without overwriting a
  -- number a person entered on purpose.
  origin     TEXT NOT NULL CHECK (origin IN ('SEEDED', 'USER')),
  -- What it is, or which convention it follows. Prose, stored, never parsed.
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

-- The seed. Every factor here is either exact by definition or named in its
-- note as the convention this build assumed. The imperial masses and the fluid
-- ounce are written to their full defined precision rather than rounded,
-- because a rounded factor is a figure that is wrong in a way nothing will ever
-- report.
--
-- **`in` is not here and never will be.** It is the word that asks for a
-- conversion, so the inch is the one unit this table cannot have — which is
-- also why a column may not be called `in`. That is the whole price of an
-- identity that reads like a sentence.

INSERT INTO measurement_unit (symbol, dimension, per_base, origin, note) VALUES
  ('µg',   'MASS',   0.000001,      'SEEDED', ''),
  ('mcg',  'MASS',   0.000001,      'SEEDED', 'The same as µg, for a keyboard without one.'),
  ('mg',   'MASS',   0.001,         'SEEDED', ''),
  ('g',    'MASS',   1,             'SEEDED', ''),
  ('kg',   'MASS',   1000,          'SEEDED', ''),
  ('oz',   'MASS',   28.349523125,  'SEEDED', 'The avoirdupois ounce, exact by definition.'),
  ('lb',   'MASS',   453.59237,     'SEEDED', 'Exact by definition.'),

  ('ml',   'VOLUME', 1,             'SEEDED', ''),
  ('cl',   'VOLUME', 10,            'SEEDED', ''),
  ('dl',   'VOLUME', 100,           'SEEDED', ''),
  ('l',    'VOLUME', 1000,          'SEEDED', ''),
  ('tsp',  'VOLUME', 5,             'SEEDED', 'A convention, not a definition. The metric teaspoon.'),
  ('tbsp', 'VOLUME', 15,            'SEEDED', 'A convention, not a definition. 20 ml in Australia — change this row if that is your kitchen.'),
  ('cup',  'VOLUME', 240,           'SEEDED', 'A convention, not a definition. The US legal cup; a metric cup is 250.'),
  ('floz', 'VOLUME', 29.5735295625, 'SEEDED', 'The US fluid ounce. The imperial one is 28.4131.'),

  ('mm',   'LENGTH', 1,             'SEEDED', ''),
  ('cm',   'LENGTH', 10,            'SEEDED', ''),
  ('m',    'LENGTH', 1000,          'SEEDED', ''),
  ('km',   'LENGTH', 1000000,       'SEEDED', ''),

  ('s',    'TIME',   1,             'SEEDED', ''),
  ('min',  'TIME',   60,            'SEEDED', ''),
  ('h',    'TIME',   3600,          'SEEDED', ''),
  ('day',  'TIME',   86400,         'SEEDED', ''),
  ('week', 'TIME',   604800,        'SEEDED', ''),

  -- The base is the kilojoule because the calorie is defined from it and not
  -- the other way round, so every factor here stays exact.
  ('kJ',   'ENERGY', 1,             'SEEDED', ''),
  ('kj',   'ENERGY', 1,             'SEEDED', 'The same as kJ, because a label prints it both ways.'),
  ('kcal', 'ENERGY', 4.184,         'SEEDED', 'The thermochemical calorie, exact by definition.'),

  ('each', 'COUNT',  1,             'SEEDED', '');
