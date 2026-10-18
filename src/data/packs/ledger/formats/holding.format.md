---
format: holding
title: Holding
language: 20
claims: none
pack: ledger
written: on the Money map screen, or with `set_place_accounts`
---

Something held — cash, a deposit, a fund, a security — in a place, or, for an account's own cash, in the account itself (M36 U08). `expected_return` and `fee` are percentages to two places, which is the old basis points exactly (D-257).

**A pension, a study fund or a provident fund is a holding too** (M36 U12, D-389): `fund_type` says it is one, and the columns after it are what only a fund has. Its `fee` is the fee on what it holds and `fee_on_deposit` the one on each deposit; an `expected_return` the provider agreed to in writing is `CONTRACTUAL`. Its reports are its readings, and its payslip lines are its deposits, worked out on read from the deduction types that name it.

**What it is worth is its latest reading, and what went in is declared** (M36 U05, D-381): `reading` is the latest `holding_reading` by its day, and `put_in` what its rows bought less what they sold, and what a person put in by hand — a deposit, a plan's, an opening balance, which is money put in as much as a row is. Code adds what moved after the reading's day — a buy, a sale, a deposit typed since — so a holding sold whole after its last reading is not worth that reading forever, and growth is that worth less `put_in`. An account's own cash has no cost: its worth is the reading and its account's rows since.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | no |  |  |  |  |
| holding_place | link | holding_place |  |  |  | no | no |  |  |  |  |
| kind | enum |  |  |  |  | yes | no | CASH, DEPOSIT, FUND, TRACK, SECURITY, OTHER |  |  |  |
| provenance | enum |  |  |  |  | yes | no | RECORDED, TRANSCRIBED, VALUED |  |  |  |
| last_confirmed | date |  |  |  |  | no | no |  |  |  |  |
| is_liquid | boolean |  |  |  |  | yes | no |  |  |  |  |
| expected_return | decimal |  | % |  | 2 | no | no |  |  |  |  |
| expected_return_basis | enum |  |  |  |  | no | no | CONTRACTUAL, ASSUMED |  |  |  |
| term_end | date |  |  |  |  | no | no |  |  |  |  |
| fee | decimal |  | % |  | 2 | no | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |
| is_archived | boolean |  |  |  |  | yes | no |  |  |  |  |
| account | link | account |  |  |  | no | yes |  |  |  | Set on the one holding that is this account's own cash (M30 U1). A bank account's is in no place; an account with holdings keeps it in the place with them (M36 U08) |
| fund_type | enum |  |  |  |  | no | no | PENSION, STUDY_FUND, PROVIDENT, MANAGERS_INSURANCE, PROVIDENT_FOR_INVESTMENT |  |  | Set on a pension, a study fund or a provident fund, and on nothing else (D-389) |
| institution | link | institution |  |  |  | no | no |  |  |  | The fund house |
| policy_number | text |  |  |  |  | no | no |  |  |  |  |
| investment_track | text |  |  |  |  | no | no |  |  |  |  |
| status | enum |  |  |  |  | no | no | ACTIVE, DORMANT, CLOSED |  |  | A fund's: a dormant one takes no deposits and still charges fees. Empty is active |
| employer_name | text |  |  |  |  | no | no |  |  |  | Which job a fund belongs to |
| opened | date |  |  |  |  | no | no |  |  |  |  |
| first_deposit | date |  |  |  |  | no | no |  |  |  | What a study fund's six years count from |
| fee_on_deposit | decimal |  | % |  | 2 | no | no |  |  |  | A fund's fee on each deposit; `fee` is the one on what it holds |
| fee_negotiated_until | date |  |  |  |  | no | no |  |  |  | A negotiated fee lapses back to the default |
| beneficiaries | text |  |  |  |  | no | no |  |  |  |  |

| aggregate | of | over | works out | unit | note |
| --- | --- | --- | --- | --- | --- |
| quantity | sum | transaction.holding | quantity |  | What its rows bought less what they sold (M30 U2) |
| reading | latest | holding_reading.holding by as_of | value |  | What its latest reading printed (M36 U05) |
| bought | sum | transaction.holding where is_excluded_from_stats is false | -amount |  | What its rows put in: a buy turned around, a sale taken back |
| deposited | sum | saving_deposit.holding where source_kind is one of MANUAL, FROM_PLAN, OPENING_BALANCE | amount |  | What a person put in by hand (D-381) |

| derived | works out | note |
| --- | --- | --- |
| put_in | bought + deposited | What went in, by its rows and by hand |

## rows
