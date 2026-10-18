---
format: card_settlement_link
title: Card payment
language: 13
claims: none
pack: ledger
written: by the importer, when it matches a card's charges to the bank line that settled them
---

A bank line that pays a card's bill, so the spending is counted once — on the card.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bank_transaction | link | transaction |  |  |  | yes | yes |  |  |  |  |
| card_account | link | account |  |  |  | yes | no |  |  |  |  |
| billing_period | month |  |  |  |  | no | no |  |  |  |  |
| match_confidence | enum |  |  |  |  | yes | no | HIGH, MEDIUM, LOW |  |  |  |
| user_decision | enum |  |  |  |  | yes | no | EXCLUDED, KEPT, PENDING |  |  |  |

## rows
