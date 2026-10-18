---
format: holding_reading
title: Holding reading
language: 13
pack: ledger
written: with `record_holding_readings`, or on a goal's page
---

What a statement said one holding was worth on a day, transcribed and never fetched (M30 U5, D-308). **A goal fed by the holding is worth its latest reading**: the growth is that reading less what went in by its day, a deposit keyed by the reading and worked out on read (D-381), so it can go down. The holding's own `reading` is the latest of these by `as_of`. Re-recording the same day changes nothing.

**A fund's report is a reading that carries its parts** (M36 U12, D-389): the employee's, the employer's and severance, and what the period brought in, charged and earned, each only where the report printed it. **The parts against the value is a claim** (D-280): a report that broke out all three has claimed they make the value, and one that left a part out has claimed nothing, which is `unchecked` rather than a failure. `deposit_gap_acknowledged` is the one answer a person gives a fund's deposit check, stored because nothing can work it out again.

`price` is a check and only a check: quantity × price should come to the value, which is how a price printed in agorot and copied as shekels is caught. **That one is a claim** (M36 U03): the value is money and enters in minor units, so the price is turned into hundredths with `× 100`, and the two agree within a tenth of a percent — a printed value is rounded to the agora and a printed price to its own places, and a factor of a hundred is never inside that. The other checks are code's, because each reads another format — the holding's rows, its account's running balance.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| holding | link | holding |  |  |  | yes | no |  |  |  |  |
| as_of | date |  |  |  |  | yes | no |  |  |  |  |
| value | money |  |  |  |  | yes | no |  |  |  | What it was worth, as printed |
| quantity | decimal |  |  |  | 6 | no | no |  |  |  | How much of it, as printed |
| cost_basis | money |  |  |  |  | no | no |  |  |  | What it cost, as printed |
| price | decimal |  |  |  | 6 | no | no |  | 0 |  | One unit's price in the value's currency, as printed: a check on quantity × price, never a source of the value |
| statement | link | statement |  |  |  | no | no |  |  |  | The statement it came from, when one was imported |
| source | text |  |  |  |  | no | no |  |  |  | The file it came from, as named, when no statement row holds it |
| note | text |  |  |  |  | no | no |  |  |  |  |
| employee | money |  |  |  |  | no | no |  |  |  | A fund's: the employee's part, as printed |
| employer | money |  |  |  |  | no | no |  |  |  | The employer's part, as printed |
| severance | money |  |  |  |  | no | no |  |  |  | Severance, as printed |
| deposits | money |  |  |  |  | no | no |  |  |  | What the report says reached the fund in its period — set against the payslips |
| fees_charged | money |  |  |  |  | no | no |  |  |  | What it says the fund charged in the period |
| return_amount | money |  |  |  |  | no | no |  |  |  | What it says the fund earned in the period, as printed — never worked out here |
| deposit_gap_acknowledged | boolean |  |  |  |  | no | no |  |  |  | The deposit gap ending at this reading was chased and found explained |

| constraint | note |
| --- | --- |
| one row per holding, as_of | One reading of a holding a day |

| claim | holds | tolerance | note |
| --- | --- | --- | --- |
| price | value = quantity * price * 100 | ± 0.1% | In minor units of a currency with hundredths; unchecked until the reading printed both a quantity and a price |
| parts | employee + employer + severance = value | ± 100 | In minor units: a report rounds each part, so the three may sit one whole unit from the value |

## rows
