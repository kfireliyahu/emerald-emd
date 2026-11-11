# M60 U2 — the glossary in Hebrew, for the maintainer's pass

*Every term a ledger document shows, with the Hebrew word the screen will say (D-583 point 5).
The rows are the source — the `screen_hebrew` column of the `term` rows in `docs/memory.emd`
(`format_rows term columns:[term, screen_hebrew]`); this sheet is for marking up. Correct a word
in the Hebrew column, or write in the note; the next session writes your words back into the rows,
and no screen is translated before that (U4, U5 and U6 wait on this pass).*

**⚑ marks a draft to look at hardest**: the word is a guess between two real choices, or there is
no settled Hebrew for the thing. Unmarked words are what a bank, card or payslip prints, or the
plain word.

How the words were chosen (D-585):

- **One word per thing, in Hebrew too**: no two terms share a Hebrew word. Where a statement prints
  the word (`printed_as`), the screen says the same.
- **A button or a command is a verbal noun** — *שמירה בשם*, *ייבוא קבצים*, *סינון*, *הוספת תלוש
  שכר* — as Israeli bank and card apps write them, so no button speaks to a man or a woman.
- **Western digits, ₪, Gregorian months** (D-583 point 4); brand names stay as they are (*Emerald*).

## The rail and Settings

| English | Hebrew | note |
|---|---|---|
| Home | בית | ⚑ or *ראשי*; *בית* is the app's first place, never the home-insurance category (*דירה*) |
| Month | חודש | Home's tab |
| Year | שנה | Home's tab |
| Transactions (Transaction) | תנועה | ⚑ banks print *תנועות*, card statements *עסקאות*; one word for both, and *תנועות* is the wider |
| Paychecks (Paycheck) | תלוש שכר | the rail says *תלושי שכר* |
| Plan | תקציב | ⚑ what a person in Israel calls this screen; the English avoids *Budget* — if that was on purpose, *תכנון חודשי* |
| Wealth | הון | ⚑ holds net worth, goals, debts and funds; *חסכונות* leaves out the debts |
| Categories (Category) | קטגוריה | |
| Dashboard | לוח בקרה | stays English for now (D-583) |
| Formats (Format) | פורמט | ⚑ stays English for now; *תבנית* is free if *פורמט* reads as jargon (the import's reader is *תבנית ייבוא*) |
| Connections (Connection) | קשר | ⚑ stays English for now |
| Agenda | סדר יום | stays English for now |
| Assistants | עוזרים | ⚑ or *עוזרי AI*; the place that connects a model to the document |
| Settings | הגדרות | |
| Guide me | הדרכה | ⚑ a verbal noun, as every button; *הראו לי איך* if it should sound like the English |
| Packs (Pack) | חבילה | Settings › Packs |
| Accounts (Account) | חשבון | a card, a bank account or cash — one word, as the ledger has one |
| Local model | מודל מקומי | |
| Export | ייצוא | |
| Language | שפה | new term: Settings' Language (D-583) |

## Home, Month and Year

| English | Hebrew | note |
|---|---|---|
| Getting started | צעדים ראשונים | M59's word |
| Read files | ייבוא קבצים | ⚑ *ייבוא* pairs with *ייצוא*; the literal *קריאת קבצים* reads as opening them |
| Add a paycheck | הוספת תלוש שכר | M59's word |
| Came in / Went out | נכנס / יצא | ⚑ plain, as the English is; *הכנסות / הוצאות* is the usual pair but *הכנסות* is the Income category |
| Left over | נשאר | *יתרה* is taken by the running balance a bank prints |
| Where it went | לאן הלך הכסף | new term: Home's list by category |
| Left out of totals | לא נכלל בסיכומים | |

## Read files and the import screen

| English | Hebrew | note |
|---|---|---|
| Statement | דף חשבון | ⚑ a bank prints *דף חשבון*, a card *פירוט חיובים*; one word for both |
| Reader | תבנית ייבוא | ⚑ a saved mapping of a kind of file; no settled Hebrew |
| Column role | תפקיד עמודה | |
| Debit / Credit | חובה / זכות | as the bank prints |
| Running balance | יתרה | as the bank prints |
| Installments | תשלומים | as the card prints |
| Standing order | הוראת קבע | as the bank prints |
| Card payment | חיוב כרטיס אשראי | the bank row that pays a card |

## Transactions and By merchant

| English | Hebrew | note |
|---|---|---|
| By merchant | לפי בית עסק | new term (the view) |
| Merchant | בית עסק | as the card prints (*שם בית העסק*) |
| Filter | סינון | M59's word |
| More | פעולות נוספות | new term: the ⋯ menu; not *עוד*, which is *N more* |
| Categorize | סיווג | the act; *לסווג* in a sentence |
| Provider category | ענף | ⚑ what Israeli card statements print for it; a bank file has none |
| Run | הרצה | one re-apply of the rules, what Undo takes back |

## Categories and rules

| English | Hebrew | note |
|---|---|---|
| Category kind | סוג קטגוריה | its five members are U4's strings |
| Rule | כלל | |
| Built-in rule | כלל מובנה | |

## Plan, with the 50 / 30 / 20 proposal

| English | Hebrew | note |
|---|---|---|
| Start with 50 / 30 / 20 | מתחילים מ־50 / 30 / 20 | new term: the proposal's heading |
| Needs · Wants · Saving | צרכים · רצונות · חיסכון | ⚑ new term; *חיסכון* is also the Savings category's draft below — the same thing, or *חסכונות* for the category |
| Bucket | סעיף | ⚑ a line of a budget; a category's bucket is its figure |
| Basis | בסיס לחלוקה | ⚑ the amount a plan splits |
| Bill | הוצאה קבועה | what the code already calls it (fixed expense) |
| Candidate | הצעה לאישור | ⚑ a bill found and not yet confirmed |
| Cadence | תדירות | |
| Monthly share | חלק חודשי | |
| Drawdown | משיכה מחסכונות | ⚑ a plan that spends more than comes in, on purpose |
| Goal | יעד | |
| Set aside | חיסכון ליעד | ⚑ *הפרשה* is a payslip's word for the employer's contribution, so not that |
| Cushion | כרית ביטחון | the Israeli phrase |

## Across the app: the document, dialogs, the desktop menu

| English | Hebrew | note |
|---|---|---|
| Document | מסמך | the .emd; *קובץ* stays for a file read in |
| Save as | שמירה בשם | |
| Back up now | גיבוי עכשיו | |
| Emerald | Emerald | the name, not translated |
| Tour | סיור | the demo's |

## Places that stay English for now — drafted for when they come

D-583 point 1 leaves Paychecks, Wealth, Dashboard and Formats in English. Their words are drafted
so the rows are whole; read these last.

**Paychecks**

| English | Hebrew | note |
|---|---|---|
| Deduction type | סוג ניכוי | |
| Pension | פנסיה | as the payslip prints |
| Severance | פיצויים | as the payslip prints |
| National Insurance | ביטוח לאומי | as the payslip prints |
| Total compensation | עלות מעביד | ⚑ gross plus the employer's side, which is what *עלות מעביד* means |
| Reconciliation delta | פער התאמה | |

**Wealth**

| English | Hebrew | note |
|---|---|---|
| Net worth | שווי נקי | |
| Accounts with holdings | חשבונות עם החזקות | |
| Balances | יתרות בחשבונות | not *יתרות* alone, the running balance's word |
| Holding | החזקה | ⚑ brokers say *אחזקות*; the standard spelling is *החזקה* |
| Holding place | מקום החזקה | ⚑ a bank, a broker, a drawer |
| Where the money is | איפה הכסף | |
| Debt | חוב | |
| Fund account | קופה | ⚑ pension, study fund, provident fund — *קופה* is how people say all of them |
| Dormant fund | קופה לא פעילה | |
| Pension fund | קרן פנסיה | as the fund prints |
| Provident fund | קופת גמל | as the fund prints |
| Study fund | קרן השתלמות | as the fund prints |
| Managers' insurance | ביטוח מנהלים | as the fund prints |
| Investment track | מסלול השקעה | as the fund prints |
| Fee on accumulation | דמי ניהול מהצבירה | as the fund prints |
| Fee on deposit | דמי ניהול מהפקדה | as the fund prints |
| Fixed deposit | פק"מ | ⚑ as the bank prints; *פיקדון* is what people say |
| Expected return | תשואה צפויה | |
| Return | תשואה | as the fund prints |
| Reading | דיווח | ⚑ a dated figure from a report |
| Provenance | מקור הנתון | |
| Institution | גוף פיננסי | ⚑ or *מוסד* |

**Dashboard and Formats**

| English | Hebrew | note |
|---|---|---|
| Block | רכיב | |
| Add a block | הוספת רכיב | |
| Headline total | נתון ראשי | |
| N more | עוד N | |
| Remove from this dashboard | הסרה מלוח הבקרה | |
| Saved view | תצוגה שמורה | |
| List | רשימה | |
| Input view | תצוגת הזנה | |
| New input view · New view · New chart | תצוגת הזנה חדשה · תצוגה חדשה · תרשים חדש | |
| Add a task · values | הוספת <פריט> · ערכים | |
| Adds as | יתווסף עם | |
| Ask · Default | לשאול · ברירת מחדל | |
| Use for Add | לשימוש בהוספה | |
| Just added · Undo | נוסף זה עתה · ביטול | |
| N done | N בוצעו | |
| Group by / Ticked when / Line | קיבוץ לפי / מסומן כאשר / שורה | |

## The ledger's seeded categories — for U6

*Not term rows: these are the names a new document made in Hebrew gets (D-583 point 6), from
`src/data/packs/ledger/seededIds.json`. U6 takes them from here after your pass. Words a card
statement prints for its sector are used where one fits.*

| English | Hebrew | note |
|---|---|---|
| Income | הכנסות | |
| Salary | משכורת | |
| Bonus | בונוס | |
| Interest | ריבית | |
| Refunds | זיכויים | a card prints *זיכוי* for a refund |
| Other income | הכנסות אחרות | |
| Living | הוצאות מחיה | |
| Groceries | סופר ומכולת | |
| Housing & Rent | דיור ושכירות | |
| Mortgage | משכנתא | |
| Municipal tax | ארנונה | |
| Utilities | חשבונות שוטפים | ⚑ *חשבון* alone is Account |
| Electricity | חשמל | |
| Water | מים | |
| Gas | גז | |
| Internet & Mobile | אינטרנט וסלולר | |
| Transport | תחבורה | |
| Fuel | דלק | |
| Car maintenance | תחזוקת רכב | |
| Parking | חניה | |
| Tolls | כבישי אגרה | |
| Public transport | תחבורה ציבורית | |
| Health & Fitness | בריאות וכושר | |
| Doctors | רופאים | |
| Dental | רופא שיניים | |
| Pharmacy | בית מרקחת | |
| Fitness | כושר | |
| Insurance | ביטוח | |
| Car (under Insurance) | רכב | |
| Health (under Insurance) | בריאות | |
| Home (under Insurance) | דירה | *ביטוח דירה*, never *בית*, the rail's Home |
| Lifestyle | פנאי | ⚑ *סגנון חיים* is a translation nobody says |
| Restaurants & Cafes | מסעדות ובתי קפה | |
| Entertainment | בילויים | |
| Shopping & Clothing | קניות וביגוד | |
| Subscriptions | מנויים | |
| Travel | חופשות ונסיעות | |
| Gifts | מתנות | |
| Family | משפחה | |
| Childcare | מעונות וגנים | |
| Education | חינוך | |
| Pets | חיות מחמד | |
| Obligations | התחייבויות | |
| Loan payments | החזרי הלוואות | |
| Taxes | מיסים | |
| Bank fees | עמלות בנק | |
| Credit card fees | עמלות כרטיס אשראי | |
| Savings | חיסכון | ⚑ the same word as *Saving* in 50 / 30 / 20 above |
| Emergency fund | קרן חירום | ⚑ or *כרית ביטחון*, if it is the Cushion's own category |
| Investments | השקעות | |
| Pension | פנסיה | the category; the payslip line is the term above |
| Study fund | קרן השתלמות | the category; the fund is the term above |
| Internal Transfer | העברה פנימית | |
| Uncategorized | ללא קטגוריה | |
