---
format: account
title: Account
language: 13
claims: none
pack: ledger
written: on the Accounts settings screen, by importing a statement, with `update_account`, or with `set_opening_balances`
---

A card, a bank account, cash or an account with holdings — where a transaction happened, or where things are held. An account with holdings (a broker, a savings account) is `HOLDINGS`, a kind of its own since M36 U09; no statement reader takes it for a bank or a card. `last4` is text because a leading zero is part of it.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| kind | enum |  |  |  |  | yes | no | CREDIT_CARD, BANK, CASH, HOLDINGS |  |  |  |
| institution | link | institution |  |  |  | no | no |  |  |  |  |
| last4 | text |  |  |  |  | no | no |  |  |  |  |
| default_billing_day | integer |  |  |  |  | no | no |  | 1 | 31 |  |
| is_archived | boolean |  |  |  |  | yes | no |  |  |  |  |
| exclude_settlements_from_stats | boolean |  |  |  |  | no | no |  |  |  | A bank account whose card settlements are counted on the card instead |
| opening_balance | money |  |  |  |  | no | no |  |  |  | What it held before the first statement, as of `opening_date` (M28 U8) |
| opening_date | date |  |  |  |  | no | no |  |  |  | The opening balance stands for everything before this day |
| in_cushion | boolean |  |  |  |  | no | no |  |  |  | Whether a bank account's latest statement counts toward what is in the bank, split between the goals saved there and the cushion (M30 U7, D-360); empty counts, only no leaves it out (M31 U5, D-371) |

## rows
