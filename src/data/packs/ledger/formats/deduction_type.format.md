---
format: deduction_type
title: Deduction type
language: 13
claims: none
pack: ledger
written: on the Deductions screen
---

A kind of line on a payslip. What it feeds is at most one of a saving goal, a debt and a fund — and a fund is a holding (D-259, D-389): its lines are the fund's deposits, worked out on read. The built-in ones are seeds.

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | yes |  |  |  |  |
| hebrew_name | text |  |  |  |  | no | no |  |  |  | As a payslip prints it |
| kind | enum |  |  |  |  | yes | no | TAX, SOCIAL_INSURANCE, HEALTH, PENSION, STUDY_FUND, SEVERANCE, LOAN_REPAYMENT, UNION, BENEFIT_IN_KIND, OTHER_DEDUCTION, ADDITION |  |  |  |
| reduces_net | boolean |  |  |  |  | yes | no |  |  |  |  |
| counts_as_saving | boolean |  |  |  |  | yes | no |  |  |  |  |
| linked_saving_goal | link | saving_goal |  |  |  | no | no |  |  |  |  |
| linked_debt | link | debt |  |  |  | no | no |  |  |  |  |
| linked_holding | link | holding |  |  |  | no | no |  |  |  | The fund it pays into (D-389) |
| is_built_in | boolean |  |  |  |  | yes | no |  |  |  |  |
| sort_order | integer |  |  |  |  | yes | no |  |  |  |  |

| constraint | note |
| --- | --- |
| at most one of linked_saving_goal, linked_debt, linked_holding | What a deduction feeds |

## rows

### Income tax
hebrew_name: מס הכנסה
kind: TAX
reduces_net: true
counts_as_saving: false
is_built_in: true
sort_order: 10

### National insurance
hebrew_name: ביטוח לאומי
kind: SOCIAL_INSURANCE
reduces_net: true
counts_as_saving: false
is_built_in: true
sort_order: 20

### Health tax
hebrew_name: מס בריאות
kind: HEALTH
reduces_net: true
counts_as_saving: false
is_built_in: true
sort_order: 30

### Pension
hebrew_name: פנסיה
kind: PENSION
reduces_net: true
counts_as_saving: true
is_built_in: true
sort_order: 40

### Study fund
hebrew_name: קרן השתלמות
kind: STUDY_FUND
reduces_net: true
counts_as_saving: true
is_built_in: true
sort_order: 50

### Severance
hebrew_name: פיצויים
kind: SEVERANCE
reduces_net: false
counts_as_saving: true
is_built_in: true
sort_order: 60

### Union dues
hebrew_name: דמי ועד
kind: UNION
reduces_net: true
counts_as_saving: false
is_built_in: true
sort_order: 70

### Meal card
hebrew_name: כרטיס הסעדה
kind: BENEFIT_IN_KIND
reduces_net: false
counts_as_saving: false
is_built_in: true
sort_order: 80

### Company car value
hebrew_name: שווי רכב
kind: BENEFIT_IN_KIND
reduces_net: false
counts_as_saving: false
is_built_in: true
sort_order: 90

### Other deduction
hebrew_name: ניכוי אחר
kind: OTHER_DEDUCTION
reduces_net: true
counts_as_saving: false
is_built_in: true
sort_order: 100
