---
format: category_rule
title: Category rule
language: 13
claims: none
pack: ledger
written: on the Rules settings screen, or with `create_rule`
---

A rule is data — a kind, a pattern and the category it assigns. The built-in rules are seeds, generated from the rule packs rather than written here.

**`categories` is the first rule set** (D-273): a rule matching a transaction's merchant sets its category, and never over one a person chose. It reads the three kinds that are text against a pattern, in the tiers `origin` lists them in and then by `priority`, and only rules with no account and no amount band — those, and `PROVIDER_CATEGORY`, `AMOUNT_RANGE` and `ACCOUNT`, stay pack code, as do learning from a correction and a model's suggestion.

`amount_min` and `amount_max` are money, each with its currency, where the old table shared one.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | yes |  |  |  |  |
| kind | enum |  |  |  |  | yes | no | EXACT_MERCHANT, CONTAINS, REGEX, PROVIDER_CATEGORY, AMOUNT_RANGE, ACCOUNT |  |  |  |
| pattern | text |  |  |  |  | yes | no |  |  |  |  |
| target | link | category |  |  |  | yes | no |  |  |  |  |
| priority | integer |  |  |  |  | yes | no |  |  |  |  |
| origin | enum |  |  |  |  | yes | no | USER, LEARNED_FROM_CORRECTION, AI_SUGGESTED, BUILT_IN |  |  |  |
| is_enabled | boolean |  |  |  |  | yes | no |  |  |  |  |
| scope_account | link | account |  |  |  | no | no |  |  |  |  |
| amount_min | money |  |  |  |  | no | no |  |  |  |  |
| amount_max | money |  |  |  |  | no | no |  |  |  |  |
| hit_count | integer |  |  |  |  | no | no |  | 0 |  | Empty is none. Not a seed's to carry: a later build correcting it would erase what the rule has matched |
| last_matched | instant |  |  |  |  | no | no |  |  |  |  |
| created | instant |  |  |  |  | no | no |  |  |  | When a person or a correction made it. A rule nothing has matched in ninety days of existing is quiet; a seed has none |

| rule set | sets | note |
| --- | --- | --- |
| categories | transaction.category from target when merchant_normalized matches pattern by kind (EXACT_MERCHANT equals, CONTAINS contains, REGEX regex) first by origin then priority where is_enabled is true and scope_account is empty and amount_min is empty and amount_max is empty, recorded in category_source as RULE, never over MANUAL, noting matched_rule | A transaction's category from the rule its merchant matches |

## rows
