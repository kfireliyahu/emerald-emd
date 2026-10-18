---
format: ingredient
title: Ingredient
language: 1
---

An ingredient as a label declares it, per a stated basis and quantity. **This is the specification for M19 U1** — `Ingredients/Pasta.md` from the author's own vault, whose twenty-five typed fields were kept consistent by hand across twelve notes with nothing enforcing them. The gap showed inside one week: one note stored `price_ils_per_100g` while another stored `price_ils` plus `package_ml`, which is two shapes for one fact.

**A format that is not money, on purpose** (D-211). If the engine cannot hold a dataset that is not money, it is a finance app with a plugin folder.

Three things in here are the app's own house style arrived at independently in another domain. `micros_basis` is a **third state** — `label`, `analogue`, `mixed` — which is `proved / failed / unchecked` (D-149) met again. `verified` is staleness tracking with nowhere to live. And `label_source` beside `micros_source` is a source per figure rather than per file, which is what the confirm surfaces do for financial documents.

**The Atwater claim is declared now** (U3, D-222), and it is the line the vault wrote by hand: `4×6.6 + 4×2 + 9×2.8 + 2×1 = 61.6 against 62 declared`. Fibre is subtracted before the rest of the carbohydrate is counted at 4 and then added back at 2, because `carbs_g` here is USDA-style and includes it — which is exactly the kind of thing the note beside a claim is for.

**What is still absent.** The cooked-to-dry cross-check at a yield of 2.0 compares *two rows* — a cooked label against a dry one — and a row cannot see another row. That is U4b's link, not U3's arithmetic. `cooked_yield_factor` is stored here because it is a column; what it *means* is still not.

| column | type | unit | required | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  | yes |  |  |  | What the ingredient is called |
| brand | text |  | no |  |  |  | The product as the packet names it, with the Hebrew |
| basis | enum |  | yes | dry, cooked, as sold |  |  | What the figures below are measured on |
| per_quantity | real | g | yes |  | 0 |  | The quantity the figures are stated per |
| cooked_yield_factor | real |  | no |  | 0 |  | Dry to cooked. 100 g of pasta becomes 200 g |
| kcal | real | kcal | yes |  | 0 |  | Energy per the stated basis and quantity |
| protein_g | real | g | yes |  | 0 |  |  |
| carbs_g | real | g | yes |  | 0 |  | USDA-style, with fibre included |
| sugars_g | real | g | no |  | 0 |  |  |
| fat_g | real | g | yes |  | 0 |  |  |
| sat_fat_g | real | g | no |  | 0 |  |  |
| fiber_g | real | g | no |  | 0 |  |  |
| sodium_mg | real | mg | no |  | 0 |  | Derived from declared salt where the label gives salt |
| vit_d_ug | real | ug | no |  | 0 |  |  |
| b12_ug | real | ug | no |  | 0 |  |  |
| folate_ug | real | ug | no |  | 0 |  | Wheat's own, unless the product is enriched |
| iron_mg | real | mg | no |  | 0 |  |  |
| calcium_mg | real | mg | no |  | 0 |  |  |
| potassium_mg | real | mg | no |  | 0 |  |  |
| magnesium_mg | real | mg | no |  | 0 |  |  |
| zinc_mg | real | mg | no |  | 0 |  |  |
| vit_a_ug | real | ug | no |  | 0 |  |  |
| vit_c_mg | real | mg | no |  | 0 |  |  |
| omega3_ala_mg | real | mg | no |  | 0 |  |  |
| omega3_epa_dha_mg | real | mg | no |  | 0 |  |  |
| micros_basis | enum |  | yes | label, analogue, mixed |  |  | Where the micronutrients came from. The third state, D-149 in another domain |
| label_source | text |  | no |  |  |  | Which declaration the macros were read off |
| micros_source | text |  | no |  |  |  | The analogue, named — "USDA FDC 168927" |
| allergens | text |  | no |  |  |  | As the packet states them |
| price | money |  | no |  |  |  | What it cost. Minor units and a currency, never a float |
| verified | date |  | no |  |  |  | When a person last checked this against the packet |

| claim | holds | tolerance | note |
| --- | --- | --- | --- |
| atwater | 4*protein_g + 4*(carbs_g - fiber_g) + 9*fat_g + 2*fiber_g = kcal | ± 2% | The label's own arithmetic. `carbs_g` is USDA-style and includes fibre, so fibre comes out at 4 and goes back in at 2 |
