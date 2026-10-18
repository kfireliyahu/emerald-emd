---
format: category
title: Category
language: 13
claims: none
pack: ledger
written: on the Categories screen, or with `create_category`
---

What a transaction was for. **A tree of three levels at most** — Living → Utilities → Electricity (D-348). A top-level category is a heading: the Categories screen and Plan list what is under it, and a budget on it counts everything filed under it. The cap is pack code and not a constraint: it compares a row with the rows it links to, and a row constraint sees one (D-259).

The name is unique because it is what a seed and a text document name the row by (D-264, D-241). Rolling a parent's spending up from its children is pack code: it is two hops and a month (D-224, D-265).

| column | type | points at | unit | per | scale | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  |  | yes | yes |  |  |  |  |
| parent | link | category |  |  |  | no | no |  |  |  | Empty for a top-level category |
| kind | enum |  |  |  |  | yes | no | EXPENSE, INCOME, TRANSFER, SAVING, DEBT_PAYMENT |  |  |  |
| color | text |  |  |  |  | no | no |  |  |  |  |
| icon | text |  |  |  |  | no | no |  |  |  |  |
| is_system | boolean |  |  |  |  | yes | no |  |  |  | Uncategorized and Internal Transfer: the ledger relies on both |
| sort_order | integer |  |  |  |  | yes | no |  |  |  |  |
| is_archived | boolean |  |  |  |  | yes | no |  |  |  |  |

## rows

### Living
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Transport
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Lifestyle
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Health & Fitness
kind: EXPENSE
is_system: false
sort_order: 40
is_archived: false

### Family
kind: EXPENSE
is_system: false
sort_order: 50
is_archived: false

### Obligations
kind: EXPENSE
is_system: false
sort_order: 60
is_archived: false

### Income
kind: INCOME
is_system: false
sort_order: 70
is_archived: false

### Savings
kind: SAVING
is_system: false
sort_order: 80
is_archived: false

### Housing & Rent
parent: Living
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Mortgage
parent: Living
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Utilities
parent: Living
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Municipal tax
parent: Living
kind: EXPENSE
is_system: false
sort_order: 40
is_archived: false

### Internet & Mobile
parent: Living
kind: EXPENSE
is_system: false
sort_order: 50
is_archived: false

### Groceries
parent: Living
kind: EXPENSE
is_system: false
sort_order: 60
is_archived: false

### Insurance
parent: Living
kind: EXPENSE
is_system: false
sort_order: 70
is_archived: false

### Fuel
parent: Transport
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Public transport
parent: Transport
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Car maintenance
parent: Transport
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Parking
parent: Transport
kind: EXPENSE
is_system: false
sort_order: 40
is_archived: false

### Tolls
parent: Transport
kind: EXPENSE
is_system: false
sort_order: 50
is_archived: false

### Restaurants & Cafes
parent: Lifestyle
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Entertainment
parent: Lifestyle
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Shopping & Clothing
parent: Lifestyle
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Travel
parent: Lifestyle
kind: EXPENSE
is_system: false
sort_order: 40
is_archived: false

### Gifts
parent: Lifestyle
kind: EXPENSE
is_system: false
sort_order: 50
is_archived: false

### Subscriptions
parent: Lifestyle
kind: EXPENSE
is_system: false
sort_order: 60
is_archived: false

### Pharmacy
parent: Health & Fitness
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Doctors
parent: Health & Fitness
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Dental
parent: Health & Fitness
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Fitness
parent: Health & Fitness
kind: EXPENSE
is_system: false
sort_order: 40
is_archived: false

### Childcare
parent: Family
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Education
parent: Family
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Pets
parent: Family
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Loan payments
kind: DEBT_PAYMENT
is_system: false
sort_order: 90
is_archived: false

### Credit card fees
parent: Obligations
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Bank fees
parent: Obligations
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Taxes
parent: Obligations
kind: EXPENSE
is_system: false
sort_order: 40
is_archived: false

### Salary
parent: Income
kind: INCOME
is_system: false
sort_order: 10
is_archived: false

### Bonus
parent: Income
kind: INCOME
is_system: false
sort_order: 20
is_archived: false

### Refunds
parent: Income
kind: INCOME
is_system: false
sort_order: 30
is_archived: false

### Interest
parent: Income
kind: INCOME
is_system: false
sort_order: 40
is_archived: false

### Other income
parent: Income
kind: INCOME
is_system: false
sort_order: 50
is_archived: false

### Pension
parent: Savings
kind: SAVING
is_system: false
sort_order: 10
is_archived: false

### Study fund
parent: Savings
kind: SAVING
is_system: false
sort_order: 20
is_archived: false

### Investments
parent: Savings
kind: SAVING
is_system: false
sort_order: 30
is_archived: false

### Emergency fund
parent: Savings
kind: SAVING
is_system: false
sort_order: 40
is_archived: false

### Uncategorized
kind: EXPENSE
is_system: true
sort_order: 100
is_archived: false

### Internal Transfer
kind: TRANSFER
is_system: true
sort_order: 110
is_archived: false

### Electricity
parent: Utilities
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Water
parent: Utilities
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Gas
parent: Utilities
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false

### Health
parent: Insurance
kind: EXPENSE
is_system: false
sort_order: 10
is_archived: false

### Home
parent: Insurance
kind: EXPENSE
is_system: false
sort_order: 20
is_archived: false

### Car
parent: Insurance
kind: EXPENSE
is_system: false
sort_order: 30
is_archived: false
