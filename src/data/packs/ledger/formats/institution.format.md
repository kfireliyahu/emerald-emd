---
format: institution
title: Institution
language: 13
claims: none
pack: ledger
written: on the Accounts settings screen, or with `add_institutions`
---

A bank, a card issuer, a broker or a fund manager — who a statement, an account or a fund belongs to. The ledger ships the Israeli ones as seeds (D-264); a person adds the rest.

**The aliases are rows of `institution_alias`**, not a JSON list in a cell: an alias is how a document names the institution, and a list in a cell is a column nothing can check.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | yes |  |  |  | What the app calls it |
| kind | enum |  |  |  |  | yes | no | CARD_ISSUER, BANK, INVESTMENT_PLATFORM, FUND_MANAGER, OTHER |  |  |  |
| color | text |  |  |  |  | no | no |  |  |  |  |
| is_user_created | boolean |  |  |  |  | yes | no |  |  |  | A person added it, rather than the pack |
| sort_order | integer |  |  |  |  | yes | no |  |  |  |  |

## rows

### Cal
kind: CARD_ISSUER
is_user_created: false
sort_order: 10

### Max
kind: CARD_ISSUER
is_user_created: false
sort_order: 20

### Isracard
kind: CARD_ISSUER
is_user_created: false
sort_order: 30

### American Express
kind: CARD_ISSUER
is_user_created: false
sort_order: 40

### Diners Club
kind: CARD_ISSUER
is_user_created: false
sort_order: 50

### Bank Hapoalim
kind: BANK
is_user_created: false
sort_order: 10

### Bank Leumi
kind: BANK
is_user_created: false
sort_order: 20

### Israel Discount Bank
kind: BANK
is_user_created: false
sort_order: 30

### Mizrahi-Tefahot
kind: BANK
is_user_created: false
sort_order: 40

### First International Bank
kind: BANK
is_user_created: false
sort_order: 50

### Bank Yahav
kind: BANK
is_user_created: false
sort_order: 60

### Bank Massad
kind: BANK
is_user_created: false
sort_order: 70

### Bank of Jerusalem
kind: BANK
is_user_created: false
sort_order: 80

### One Zero
kind: BANK
is_user_created: false
sort_order: 90

### IBI
kind: INVESTMENT_PLATFORM
is_user_created: false
sort_order: 10

### Meitav
kind: INVESTMENT_PLATFORM
is_user_created: false
sort_order: 20

### Excellence
kind: INVESTMENT_PLATFORM
is_user_created: false
sort_order: 30

### Psagot
kind: INVESTMENT_PLATFORM
is_user_created: false
sort_order: 40

### Interactive Brokers
kind: INVESTMENT_PLATFORM
is_user_created: false
sort_order: 50

### eToro
kind: INVESTMENT_PLATFORM
is_user_created: false
sort_order: 60

### Menora Mivtachim
kind: FUND_MANAGER
is_user_created: false
sort_order: 10

### Migdal
kind: FUND_MANAGER
is_user_created: false
sort_order: 20

### Clal Insurance
kind: FUND_MANAGER
is_user_created: false
sort_order: 30

### Harel
kind: FUND_MANAGER
is_user_created: false
sort_order: 40

### The Phoenix
kind: FUND_MANAGER
is_user_created: false
sort_order: 50

### Altshuler Shaham
kind: FUND_MANAGER
is_user_created: false
sort_order: 60

### Yelin Lapidot
kind: FUND_MANAGER
is_user_created: false
sort_order: 70

### More
kind: FUND_MANAGER
is_user_created: false
sort_order: 80
