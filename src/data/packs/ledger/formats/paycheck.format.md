---
format: paycheck
title: Paycheck
language: 19
pack: ledger
written: on the Paychecks screen, or with `record_paychecks`
---

One payslip. **Net against gross less the lines that reduce it** is a filtered aggregate and a claim (D-260, M25 U7): `deducted` folds only the lines whose type reduces net — the employer's pension is on the slip and never left the gross — and `net` holds to the agora. A slip with no lines has claimed no itemization: `deducted` is then zero, and `net` is unchecked rather than failed, because no line points at the slip yet (D-465); the entry screen's delta still offers what was not itemized as one line.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| employer_name | text |  |  |  |  | no | no |  |  |  |  |
| period | month |  |  |  |  | yes | no |  |  |  |  |
| payment_date | date |  |  |  |  | yes | no |  |  |  |  |
| gross | money |  |  |  |  | yes | no |  |  |  |  |
| net | money |  |  |  |  | yes | no |  |  |  |  |
| deposited_to | link | account |  |  |  | no | no |  |  |  |  |
| note | text |  |  |  |  | no | no |  |  |  |  |
| source_kind | enum |  |  |  |  | yes | no | MANUAL, PDF_PARSED, AI_PARSED |  |  |  |
| attachment_ref | text |  |  |  |  | no | no |  |  |  |  |
| is_irregular | boolean |  |  |  |  | yes | no |  |  |  |  |

| aggregate | of | over | works out | unit | note |
| --- | --- | --- | --- | --- | --- |
| deducted | sum | paycheck_line.paycheck where deduction_type.reduces_net is true | employee |  | What came out of take-home pay |
| saved_employee | sum | paycheck_line.paycheck where deduction_type.counts_as_saving is true | employee |  | The employee's side of the lines that put money away (M36 U03) |
| employer_paid | sum | paycheck_line.paycheck where employer is not empty | employer |  | What the employer paid beside the slip's lines — its pension and severance (M36 U04) |
| tax | sum | paycheck_line.paycheck where deduction_type.kind is one of TAX, SOCIAL_INSURANCE, HEALTH | employee |  | Income tax, national insurance and health tax (docs/05, M36 U04) |

| derived | works out | note |
| --- | --- | --- |
| unexplained | gross - deducted - net | What the lines do not account for between gross and net: what the net claim fails by, signed |
| compensation | gross + employer_paid | What the job pays: gross, and the employer's side beside it (M36 U04) |
| tax_rate | tax / gross | The effective tax rate, as a share of gross; empty when gross is zero (M36 U04) |

| claim | holds | tolerance | note |
| --- | --- | --- | --- |
| net | net = gross - deducted |  | Zero is every agora between gross and net accounted for |

## rows
