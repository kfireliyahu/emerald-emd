-- 005_category_depth_on_update — close the hole in the two-level rule.
--
-- Numbered and immutable after release. See D-020 and docs/02-architecture.md.
--
-- 002 caps category depth at two levels with a BEFORE INSERT trigger, which was
-- right for a table that only ever received seed rows. Reparenting arrives with
-- the categories management screen (docs/f02, "Operations"), and reparenting is
-- an UPDATE — so today a three-level tree is one UPDATE away, and every picker
-- and chart downstream assumes it cannot happen.
--
-- Two rules, and the second is the one that is easy to miss: a category may not
-- be given a parent that itself has one, *and* a category that already has
-- children may not be given a parent. Either one alone leaves a way to build
-- the third level.

CREATE TRIGGER category_max_depth_update
BEFORE UPDATE OF parent_id ON category
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM category WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Categories nest two levels at most');
END;

CREATE TRIGGER category_no_parent_for_a_parent
BEFORE UPDATE OF parent_id ON category
WHEN NEW.parent_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM category WHERE parent_id = NEW.id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'A category with subcategories cannot become one');
END;

-- A category may not be its own parent. Trivially true of the seed set and
-- trivially reachable from a UI that lets someone pick a parent from a list.
CREATE TRIGGER category_no_self_parent
BEFORE UPDATE OF parent_id ON category
WHEN NEW.parent_id = NEW.id
BEGIN
  SELECT RAISE(ABORT, 'A category cannot be its own parent');
END;
