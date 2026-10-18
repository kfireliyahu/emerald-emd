/**
 * Builds the committed synthetic fixtures in fixtures/synthetic/.
 *
 * These are not statements and are not pretending to be. They exist to cover
 * file *shapes* (docs/conventions.md: real files never enter the repo, public
 * tests use synthetic fixtures only). Real Cal and Max exports stay in
 * fixtures/real/, which is gitignored.
 *
 *   node scripts/make-synthetic-fixtures.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'synthetic')
mkdirSync(outDir, { recursive: true })

/**
 * A date cell, written the way a real .xlsx holds one: an integer serial number
 * counting days from 1899-12-30, plus a number format that says it is a date.
 *
 * Deliberately not `new Date(...)`. SheetJS converts a Date to a serial through
 * the local timezone, and in Asia/Jerusalem the 1899 base date lands on a
 * historical LMT offset of +02:20:54 — not a whole number of minutes. The
 * rounding leaks out as ~40 seconds of drift on every date, which is exactly
 * the kind of corruption these fixtures exist to catch rather than contain.
 */
class ExcelDate {
  constructor(year, month, day) {
    this.serial = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000)
  }
}

const d = (year, month, day) => new ExcelDate(year, month, day)

/**
 * A number carrying a currency number format — how Cal writes every amount.
 * The cell is a real number; the shekel sign and the thousands separator live
 * in the format, not in the value. A reader that decides "has a format, must be
 * a date" or "shows a ₪, must be text" gets both of them wrong.
 */
class Money {
  constructor(amount) {
    this.amount = amount
  }
}

const ils = (amount) => new Money(amount)

// A statement-shaped grid: a junk preamble, a header that is not row 1, and data
// rows whose cells deliberately span every type SheetTable has to distinguish.
// Row numbers in the comments are 1-based, as a spreadsheet shows them.
const rows = [
  ['כרטיס אשראי — דוגמה סינתטית'], //  1  title
  [], //  2  blank
  ['בעל הכרטיס', 'ישראל ישראלי'], //  3
  ['תקופת חיוב', d(2026, 7, 1)], //  4  real date cell in the preamble
  ['סה"כ לחיוב', 4210.55], //  5  real number cell in the preamble
  ['מספר כרטיס', '****1234'], //  6  digits in a string, not a number
  [], //  7  blank
  ['הערה', 'שורות הכותרת מתחילות בשורה 9'], //  8
  [
    'תאריך עסקה',
    'שם בית עסק',
    'סכום עסקה',
    'סכום חיוב',
    'תאריך חיוב',
    'תשלומים',
    'זוהה',
    'הערות',
  ], //  9  the real header row
  // Currency-formatted numbers, as a real Cal export writes them.
  [d(2026, 7, 3), 'שופרסל דיל 344', ils(421.05), ils(421.05), d(2026, 8, 2), '', true, ''], // 10
  [d(2026, 7, 5), 'פז ילו', ils(289), ils(289), d(2026, 8, 2), '', true, 'דלק'], // 11
  [d(2026, 7, 11), 'ראמי לוי 12', ils(1184.2), ils(1184.2), d(2026, 8, 2), '1 מתוך 3', true, ''], // 12
  // Amounts as text: a trailing minus and a thousands separator, the two shapes
  // that break a naive parseFloat. They must stay strings here.
  [d(2026, 7, 14), 'החזר כספי', '1,234.56-', '1,234.56-', d(2026, 8, 2), '', false, ''], // 13
  // A date written as text rather than stored as a date cell. This is not a
  // hypothetical: a real Max export writes every date this way, so a whole file
  // can arrive with no date cells in it at all.
  ['19-07-2026', 'AMAZON.COM', 42.99, 158.3, d(2026, 8, 2), '', false, 'USD'], // 14
  [d(2026, 7, 22), 'קפה  נמרוד', 32, 32, d(2026, 8, 2), '', true, ''], // 15  double space
  [], // 16  blank row between data and totals
  ['סה"כ', '', '', 4210.55], // 17  trailing total row
]

/**
 * A grid into a sheet, with the number formats real exports carry.
 *
 * For a date the format is the only thing marking the cell as one, and it is
 * what SheetTable reads to tell a date from a number. The currency format is
 * here to prove the reader does not overreach: it is a format too, and the cell
 * underneath is still a plain number.
 */
function toSheet(grid) {
  const sheet = XLSX.utils.aoa_to_sheet(
    grid.map((row) =>
      row.map((v) => {
        if (v instanceof ExcelDate) return v.serial
        if (v instanceof Money) return v.amount
        return v
      }),
    ),
  )

  grid.forEach((row, r) =>
    row.forEach((value, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (!cell) return
      // Both format strings are copied verbatim from a real Cal export. The date
      // one is locale-tagged rather than a plain `dd/mm/yyyy`, which is exactly
      // the kind of format a hand-rolled "does this look like a date" check misses.
      if (value instanceof ExcelDate) cell.z = '[$-,101]d/m/yy;@'
      if (value instanceof Money) cell.z = '[$₪] #,##0.00'
    }),
  )

  return sheet
}

function write(fileName, sheets) {
  const workbook = XLSX.utils.book_new()
  for (const [name, grid] of sheets) XLSX.utils.book_append_sheet(workbook, toSheet(grid), name)

  const path = join(outDir, fileName)
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  console.log(`wrote ${path}`)
}

write('typed-cells.xlsx', [['עסקאות', rows]])

// --- Installments and foreign currency -------------------------------------
//
// The shape neither real export happened to contain (docs/f01) and the one that
// makes the "original amount" column ambiguous: on an installment row a Cal
// file puts the **whole purchase** in `סכום עסקה` and the slice in `סכום חיוב`,
// which reads exactly like a foreign row unless the currency is consulted.
// See D-035.
const installmentRows = [
  ['כרטיס אשראי — תשלומים, דוגמה סינתטית'], //  1
  [], //  2
  [
    'תאריך עסקה',
    'שם בית עסק',
    'סכום עסקה',
    'מטבע עסקה מקורי',
    'סכום חיוב',
    'תאריך חיוב',
    'תשלומים',
  ], //  3  header
  // Two slices of one ₪1,200 purchase, as two months of statements state it:
  // same merchant, same purchase date, same total, different slice.
  [d(2026, 3, 14), 'איקאה נתניה', ils(1200), '', ils(100), d(2026, 8, 2), 'תשלום 3 מתוך 12'], //  4
  [d(2026, 3, 14), 'איקאה נתניה', ils(1200), '', ils(100), d(2026, 9, 2), 'תשלום 4 מתוך 12'], //  5
  // A second purchase, same shop, same afternoon, different price. The near
  // miss a group key has to survive.
  [d(2026, 3, 14), 'איקאה נתניה', ils(2400), '', ils(200), d(2026, 8, 2), 'תשלום 3 מתוך 12'], //  6
  // A genuine conversion: the original is in another currency, and the row is
  // not an installment at all.
  ['19-07-2026', 'AMAZON.COM', 42.99, 'USD', ils(158.3), d(2026, 8, 2), ''], //  7
  // The domestic row a provider fills in anyway, repeating the charge. Neither
  // a purchase total nor a conversion.
  [d(2026, 7, 2), 'קפה גן עד', ils(106), '₪', ils(106), d(2026, 8, 2), ''], //  8
]

// The same purchases in the other shape: two numeric counter columns instead of
// a sentence. `installmentSequence` and `installmentTotal` exist for this file.
const numberedRows = [
  ['כרטיס אשראי — תשלומים ממוספרים'], //  1
  [], //  2
  ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב', 'תשלום מספר', 'סך תשלומים'], //  3
  [d(2026, 3, 14), 'איקאה נתניה', ils(1200), ils(100), 3, 12], //  4
  [d(2026, 3, 14), 'איקאה נתניה', ils(1200), ils(100), 4, 12], //  5
  [d(2026, 7, 2), 'קפה גן עד', ils(106), ils(106), '', ''], //  6
]

write('installments.xlsx', [
  ['תשלומים', installmentRows],
  ['תשלומים ממוספרים', numberedRows],
])
