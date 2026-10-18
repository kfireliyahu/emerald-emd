---
type: feature
project: Emerald
milestone: M1
status: built
---

# F02 — Category System

The user's own taxonomy for spending. Everything downstream — rules, statistics, the
splitter, fixed expenses — hangs off this.

**Built, and closed with M1.** The `category` table (and `category_group`, retired by D-348) with the seed set
(migration `002`), depth enforced by triggers rather than by the repository so it holds against
any writer including a SQLite browser (`005` added the `UPDATE` guards), and a Categories screen
at `#/categories` covering create, rename, reparent, **merge**, archive, delete (moving what still uses it first, D-340) and
reorder (D-029). Manual assignment is `MANUAL` and permanent (D-009), and since migration `010`
it is audited (D-042). Deleting a category disables the rules pointing at it, in the same
mutation as the delete (D-040).

**Finished later, each in its own milestone.** `monthlyTargetAmount` landed in M4 with the
splitter that first writes it (D-058). The **colour and icon** landed in M6 (D-105): one popover on
the Categories screen, offering the palette's eight token names and an "automatic" rather than a
hex, because the app has two themes and the palette carries a lifted variant of every hue. M13
finished what that left open (**D-161**): a colour is resolved against the whole taxonomy, so an
automatic one is displaced off a slot a sibling already holds and the popover marks the ones that
are taken. Eight hues cannot make forty top-level categories distinct and the popover says so
rather than pretending.

**The groups are gone** (D-348): F25 made them editable (D-342), and F29 found they were top-level
categories by another name. A heading is made, renamed and moved like any category.

## User stories

- As a user, I define my own categories rather than accepting the app's.
- As a user, I start from a sensible default set and edit it instead of building from zero.
- As a user, I can nest one level (Food → Groceries, Food → Restaurants) and see either level.
- As a user, I can merge two categories I created by mistake without losing history.
- As a user, I can archive a category I stopped using without deleting years of transactions.

## Structure

- **Three levels maximum** since M28 F29 (D-348): a top-level category is a heading (Living, Income),
  then a category, then a subcategory. The groups that sat above a two-level tree became the top level.
- A budget on any category counts everything under it; Plan lists its buckets under the top level.
- Each category has a `kind` (`EXPENSE`, `INCOME`, `TRANSFER`, `SAVING`, `DEBT_PAYMENT`) which
  determines where it may be used and how statistics treat it.

## Seed set (editable, not sacred)

**Living** — Housing/Rent, Mortgage, Utilities (Electric, Water, Gas), Municipal tax (ארנונה),
Internet & Mobile, Groceries, Insurance (Health, Home, Car).
**Transport** — Fuel, Public transport, Car maintenance, Parking, Tolls.
**Lifestyle** — Restaurants & Cafes, Entertainment, Shopping & Clothing, Travel, Gifts,
Subscriptions.
**Health** — Pharmacy, Doctors, Dental, Fitness.
**Family** — Childcare, Education, Pets.
**Obligations** — Loan payments, Credit card fees, Bank fees, Taxes.
**Income** — Salary, Bonus, Refunds, Interest, Other income.
**Savings** — Pension, Study fund, Investments, Emergency fund.
**System** — Uncategorized, Internal Transfer (both `isSystem`, undeletable).

Seeded on first launch with a one-screen "keep all / choose which" step so the user isn't
handed 40 categories they didn't ask for.

## Operations

| Operation | Behavior |
|---|---|
| Create | Name, kind, parent, color, icon, optional monthly target. |
| Rename | Free; history follows. |
| Reparent | Allowed within the depth-2 constraint. |
| Merge | Choose target; all transactions, rules, fixed expenses, and split buckets repoint; the merge is logged so the change is explainable later. Offered as an undoable action. |
| Archive | Hidden from pickers, retained in stats with a visual marker. |
| Delete | Only if unused by transactions, rules, buckets, or fixed expenses. Otherwise the UI offers merge or archive instead. |
| Reorder | Manual sort order used consistently in every picker and chart legend. |

## Monthly target

An optional per-category `monthlyTargetAmount`. It is **not a budget with enforcement** —
no alerts, no blocking. It surfaces in two places: the splitter (as a suggested bucket amount)
and monthly statistics (as a reference line). Keeping it advisory is a deliberate scope choice.

**Built** in M4 (D-058), read and written for the first time since its columns landed in migration
002. It is an always-visible field on every category row rather than a setting behind an edit
button, because the splitter's apply flow **writes it on your behalf** — and a value the app sets
with nowhere to see or correct it is the invisible automation docs/conventions rules out. Empty
clears it, and clearing writes null rather than zero: "no target" and "a target of ₪0" are
different claims.

## Screens

- **Categories** — grouped tree that **folds by group**, a **search** (a parent stays on screen
  to hold up a matching child, marked as context), ↑/↓ to reorder, inline add, and the badge this
  note asked for in M1 and got in M13 (**D-162**): rows filed and last-90-day spend per category,
  or `unused`, so the ones to merge or archive are visible. Drag to reorder is **still not built**;
  the arrows are the movement.
- **Category editor** — name, parent, kind, monthly target, and the colour/icon popover
  (D-105). There is no separate editor screen: each of those is edited in place on the row, which
  is what keeps a forty-six-row taxonomy editable without a round trip per change.
- **Merge flow** — pick source and target, preview counts of what will move, confirm.
- **Move flow** — the reparent, in the same panel shape as merge and for the same reason: it moves
  history too. Only parents of the **same kind** are offered (D-162), with room for the category and
  what it carries inside three levels (D-348).
- **Category picker** (reused everywhere) — search and create-new inline. **Recent-first is
  still not built**; the list is in the taxonomy's own order. This
  component gets used dozens of times per import session; it must be fast and keyboard-friendly.
  Its mark is the category's icon, or a dot in the category's colour — the same hue the charts draw
  it in, which since D-161 is a guarantee rather than a hope: the picker resolves the same palette
  the donut does. A hollow dot means nothing is chosen, which is not the same as Uncategorized
  (D-105).
  **Create-new inline is built** (D-158, and it was specified here from M1 to M13 without
  existing). Typing a name nothing is called offers *Create “…”* as the last row of the list, and with
  nothing typed the same row says *+ New…* (M31 U6, D-372);
  taking it opens name, parent and kind in the same popover, at a **stated** default — top level,
  `expense` — and the category it makes is chosen for the row you were standing on. The kind
  control disappears once a parent is picked, because `createCategory` takes the parent's kind.
  The picker **writes**, which nothing else in `ui/components/` does: an `onCreate` prop would
  have been nine call sites and nine chances to leave the offer off. All nine got it and none
  changed.

## Edge cases

- Deleting a category referenced by a rule → offer to repoint or delete the rule too.
- Merging a parent into a child, or a category into its own descendant → blocked.
- Two categories with the same name under different parents → allowed; pickers show the path.
- Archiving a category that a `FixedExpense` or `SplitBucket` points at → warn and offer to
  repoint.

## Acceptance criteria

- Seeding is idempotent; a second launch does not duplicate seeds.
- Merge moves every reference and leaves no orphans (verified by an invariant test).
- Category picker opens and filters 100 categories with no perceptible delay.

## Open questions

- Should `kind` be user-visible or inferred? Recommendation: visible but pre-filled, since
  mis-typed income categories corrupt every statistic.
- Should categories support a "hidden from splitter" flag? Likely yes by M4; note it then.

## Related

[04 Data Model](./04-data-model.md) · [F03 Auto Categorization Engine](./f03-auto-categorization-engine.md) · [F09 Fixed Monthly Expenses](./f09-fixed-monthly-expenses.md) · [F10 Statistics and Reports](./f10-statistics-and-reports.md)
