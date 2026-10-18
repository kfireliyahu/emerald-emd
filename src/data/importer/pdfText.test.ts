/**
 * Reading a PDF payslip, against a PDF that is actually one.
 *
 * `fixtures/synthetic/payslip-2026-07.pdf` is built by
 * `scripts/make-payslip-pdf.mjs` from the same figures as the `.txt` beside it,
 * with an embedded Hebrew CID font, a ToUnicode CMap, and its Hebrew runs
 * stored in **visual** order the way a layout engine emits them. That is what
 * makes this a test of the reading rather than of the arithmetic: if the bidi
 * pass, the CMap or the column ordering goes wrong, the labels come out
 * mangled or the employer column lands in the employee's place.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { formatMoney } from '@/core/money.ts'
import type { PayslipLines } from '@/domain/modelTasks.ts'

import {
  extractPdfText,
  linesFromItems,
  placeLines,
  unreadableLabels,
  type PdfTextItem,
} from './pdfText.ts'
import { readPayslip } from './payslipTemplate.ts'

const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/synthetic/payslip-2026-07.pdf', import.meta.url),
)

function item(text: string, x: number, y: number, width: number, rtl = false): PdfTextItem {
  return { text, x, y, width, size: 10, rtl }
}

describe('linesFromItems', () => {
  it('reads a left-to-right page left to right', () => {
    expect(linesFromItems([item('Gross', 60, 700, 30), item('131,400.00', 160, 700, 50)])).toBe(
      'Gross' + ' '.repeat(23) + '131,400.00',
    )
  })

  it('reads a right-to-left page right to left', () => {
    // The label sits at the right margin and the columns march leftwards, so
    // descending x is the logical string — the same one the .txt fixture has.
    const line = linesFromItems([
      item('פנסיה', 510, 700, 35, true),
      item('24,500.00', 290, 700, 50),
      item('1,470.00', 195, 700, 45),
      item('1,592.50', 95, 700, 45),
    ])

    expect(line.split(/\s+/)).toEqual(['פנסיה', '24,500.00', '1,470.00', '1,592.50'])
  })

  it('joins two runs with no gap into one word', () => {
    // A mixed-script label is three runs and one word: `בע` + `"` + `מ`.
    expect(linesFromItems([
      item('בע', 100, 700, 12, true),
      item('"', 96, 700, 4),
      item('מ', 89, 700, 7, true),
    ])).toBe('בע"מ')
  })

  it('separates a label from its figures by more than one space', () => {
    // `payslipTemplate` splits a label off on two-or-more spaces, so a wide gap
    // has to survive as a wide gap.
    const line = linesFromItems([item('מס הכנסה', 420, 700, 45, true), item('3,980.50', 330, 700, 45)])
    expect(line.split(/\s{2,}/)).toEqual(['מס הכנסה', '3,980.50'])
  })

  it('keeps an empty column, however wide the hole it leaves', () => {
    // A deductions table with a basis column has a hole in every row that has
    // no basis — as wide as a panel and emphatically not one, because what
    // follows it is the row's next figure rather than another panel's name.
    const line = linesFromItems([
      item('מס הכנסה', 500, 700, 45, true),
      item('3,980.50', 200, 700, 45),
    ])

    expect(line).not.toContain('\n')
    expect(line.split(/\s{2,}/)).toEqual(['מס הכנסה', '3,980.50'])
  })

  it('splits a row from the totals box printed beside it', () => {
    // The bug a real payslip found. The deductions total sits in its own panel
    // at the same height as a deduction row, and joined to it the row's last
    // two figures read as employee and employer — so ₪9,220.00 of "employer
    // contribution" appeared against a line that has none, and both proofs
    // still passed, because no equation runs through that column (D-138).
    const line = linesFromItems([
      item('פנסיה', 540, 700, 30, true),
      item('923.00', 460, 700, 35),
      item('סה"כ ניכויים', 240, 700, 55, true),
      item('9,220.00', 120, 700, 40),
    ])

    // Two lines, each keeping its own label with its own figure — and the
    // right-hand panel first, because the page reads right to left.
    expect(line.split('\n').map((piece) => piece.split(/\s{2,}/))).toEqual([
      ['פנסיה', '923.00'],
      ['סה"כ ניכויים', '9,220.00'],
    ])
  })

  it('puts a lower line after a higher one, whatever order they arrive in', () => {
    expect(
      linesFromItems([item('second', 60, 680, 30), item('first', 60, 700, 30)]).split('\n'),
    ).toEqual(['first', 'second'])
  })

  it('keeps two runs on one line when their baselines differ slightly', () => {
    // A Hebrew label and a Latin figure are different fonts and rarely sit on
    // exactly the same baseline.
    expect(
      linesFromItems([item('נטו', 500, 700, 20, true), item('16,205.00', 420, 698.4, 45)]),
    ).not.toContain('\n')
  })

  it('has nothing to say about a page with no runs on it', () => {
    expect(linesFromItems([])).toBe('')
    expect(linesFromItems([item('   ', 60, 700, 10)])).toBe('')
  })
})

describe('a real PDF', () => {
  it('reads the Hebrew right way round, through the embedded font', async () => {
    const extract = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))

    expect(extract.kind).toBe('text')
    if (extract.kind !== 'text') return
    expect(extract.pages).toBe(1)

    // Not `הסנכה סמ`, which is what a missing bidi pass produces, and not `סה`,
    // which is what a grammar produced when a model was asked to copy a label
    // (D-137).
    expect(extract.text).toContain('מס הכנסה')
    expect(extract.text).toContain('סה"כ ברוטו')
    expect(extract.text).toContain('נטו לתשלום')
  })

  it('reconstructs the deductions table in the order the figures belong in', async () => {
    const extract = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))
    if (extract.kind !== 'text') throw new Error('expected text')

    const pension = extract.text.split('\n').find((line) => line.startsWith('פנסיה'))
    expect(pension?.split(/\s+/)).toEqual(['פנסיה', '24,500.00', '1,470.00', '1,592.50'])

    // The dash the slip prints where an amount does not apply, kept as a
    // position rather than dropped.
    const severance = extract.text.split('\n').find((line) => line.startsWith('פיצויים'))
    expect(severance?.split(/\s+/)).toEqual(['פיצויים', '24,500.00', '—', '2,040.85'])
  })

  it('reads to the agora, and the slip agrees with itself', async () => {
    const extract = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))
    if (extract.kind !== 'text') throw new Error('expected text')

    const lines = extract.text.split('\n')
    const at = (starts: string): number => lines.findIndex((line) => line.startsWith(starts)) + 1

    const template: PayslipLines = {
      grossLine: at('סה"כ ברוטו'),
      netLine: at('נטו לתשלום'),
      employeeDeductionsTotalLine: at('סה"כ ניכויי עובד'),
      salaryMonthLine: at('חודש שכר'),
      payDateLine: at('תאריך תשלום'),
      deductionLines: [
        'מס הכנסה',
        'ביטוח לאומי',
        'מס בריאות',
        'פנסיה',
        'קרן השתלמות',
        'פיצויים',
        'דמי ועד',
        'ניכוי הלוואה',
      ].map((label) => ({ line: at(label), hasEmployerColumn: true, hasBasisColumn: true })),
    }

    const reading = readPayslip(template, extract.text)

    expect(formatMoney(reading.gross!)).toBe('₪24,500.00')
    expect(formatMoney(reading.net!)).toBe('₪16,205.00')
    expect(reading.deductions).toHaveLength(8)
    expect(formatMoney(reading.delta!)).toBe('₪0.00')
    expect(formatMoney(reading.statedTotalDelta!)).toBe('₪0.00')
    expect(reading.reconciles).toBe(true)
    expect(reading.salaryMonth).toEqual({ year: 2026, month: 7 })
    expect(reading.payDate).toEqual({ year: 2026, month: 8, day: 1 })
  })

  it('says a file is not a PDF rather than throwing', async () => {
    const extract = await extractPdfText(new TextEncoder().encode('this is not a pdf'))

    expect(extract.kind).toBe('failed')
    if (extract.kind !== 'failed') return
    expect(extract.reason).toContain('not a PDF')
  })
})

describe('unreadableLabels', () => {
  const run = (text: string, font: string): PdfTextItem => ({
    text,
    x: 0,
    y: 0,
    width: 10,
    size: 10,
    rtl: false,
    font,
  })

  it('finds the font whose words are not words', () => {
    // What a real payslip produced: Arial set the headings and read perfectly,
    // a subset of Miriam set the table and did not. One run per label, which is
    // how pdf.js hands them over.
    expect(
      unreadableLabels([
        run('מס הכנסה', 'arial'),
        run('ביטוח לאומי', 'arial'),
        run('ª»«¬ª »≈', 'miriam'),
        run('¿≈º∑√ æºø¿∏', 'miriam'),
        run('“º∑¿–∏ ¿≈∫', 'miriam'),
      ]),
    ).toBe(true)
  })

  it('leaves a document whose fonts all read alone', () => {
    expect(
      unreadableLabels([run('מס הכנסה פנסיה נטו לתשלום', 'arial'), run('24,500.00', 'miriam')]),
    ).toBe(false)
  })

  it('does not accuse a font that only sets figures', () => {
    // Digits, separators and a dash or two. No words to be wrong about.
    expect(
      unreadableLabels([
        run('30,900.00', 'miriam'),
        run('—', 'miriam'),
        run('900.00', 'miriam'),
        run('—', 'miriam'),
        run('100.00', 'miriam'),
      ]),
    ).toBe(false)
  })

  it('finds the font that sets the figures *and* the broken words', () => {
    // The correction a real slip forced. Counting characters across the font,
    // its 353 digits drowned its 93 symbols and it passed as readable; the
    // question is whether its *words* are words, and they are not.
    const figures = Array.from({ length: 20 }, () => run('30,900.00', 'miriam'))
    expect(
      unreadableLabels([...figures, run('ª»«¬ª', 'miriam'), run('»≈¿', 'miriam'), run('“º∑¿–∏', 'miriam')]),
    ).toBe(true)
  })

  it('does not accuse a stray symbol in ordinary text', () => {
    expect(
      unreadableLabels([run('Salary', 'arial'), run('€', 'arial'), run('24,500.00', 'arial')]),
    ).toBe(false)
  })
})

/**
 * A document that lies about its own text.
 *
 * `payslip-2026-07-mislabelled.pdf` is the same slip with a subsetter's
 * boilerplate `ToUnicode` table over its Hebrew glyphs — the failure the first
 * real Israeli payslip arrived with. Every reader obeys the document and prints
 * mathematical operators; the embedded font's own `cmap` still says what each
 * glyph is, and that is what `pdfFontMap.ts` goes and gets.
 */
describe('a PDF whose ToUnicode map is wrong', () => {
  const MISLABELLED = fileURLToPath(
    new URL('../../../fixtures/synthetic/payslip-2026-07-mislabelled.pdf', import.meta.url),
  )

  it('reads the Hebrew anyway, out of the font rather than the document', async () => {
    const extract = await extractPdfText(new Uint8Array(readFileSync(MISLABELLED)))

    expect(extract.kind).toBe('text')
    if (extract.kind !== 'text') return

    expect(extract.text).toContain('מס הכנסה')
    expect(extract.text).toContain('סה"כ ברוטו')
    expect(extract.text).toContain('נטו לתשלום')
    // And it knows it no longer has a problem to warn about.
    expect(extract.unreadableLabels).toBe(false)
  })

  it('reads the same figures as the honest copy of the same slip', async () => {
    const honest = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))
    const repaired = await extractPdfText(new Uint8Array(readFileSync(MISLABELLED)))
    if (honest.kind !== 'text' || repaired.kind !== 'text') throw new Error('expected text')

    const pension = (text: string) =>
      text.split('\n').find((line) => line.startsWith('פנסיה'))?.split(/\s+/)

    expect(pension(repaired.text)).toEqual(['פנסיה', '24,500.00', '1,470.00', '1,592.50'])
    expect(pension(repaired.text)).toEqual(pension(honest.text))
  })

  it('leaves an honest document exactly as it was', async () => {
    // The repair never runs on a file with nothing wrong with it, and could not
    // make one worse if it did: a chart is kept only when it produces more
    // letters than the text already had.
    const extract = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))
    if (extract.kind !== 'text') throw new Error('expected text')

    expect(extract.unreadableLabels).toBe(false)
    expect(extract.text).toContain('קרן השתלמות')
  })
})

describe('placeLines', () => {
  it('gives every line of the text a box, and one for a page with nothing on it', () => {
    const placed = placeLines([item('Gross', 60, 700, 30), item('Net', 60, 680, 20)], 1)

    expect(placed.map((line) => line.text)).toEqual(['Gross', 'Net'])
    expect(placed.every((line) => line.box?.page === 1)).toBe(true)

    // A blank page still contributes the one empty line joining the pages has
    // always given it — otherwise every line number after it is off by one.
    expect(placeLines([], 3)).toEqual([{ text: '', box: undefined }])
  })

  it('is the same lines the text is made of, in the same order', () => {
    // The property the highlight rests on. Not "they happen to agree here" —
    // `linesFromItems` is this function with the boxes dropped, so a change
    // that broke the alignment would have to break the text with it.
    const items = [
      item('פנסיה', 420, 700, 45, true),
      item('1,470.00', 330, 700, 45),
      item('נטו לתשלום', 500, 680, 60, true),
      item('16,205.00', 420, 680, 45),
    ]

    expect(placeLines(items, 1).map((line) => line.text).join('\n')).toBe(linesFromItems(items))
  })

  it('boxes a panel of its own rather than the width of the page', () => {
    // Two panels printed at one height are two lines (D-142), and the boxes
    // have to agree: one box spanning both would frame half the page and point
    // at neither.
    const placed = placeLines(
      [item('Deductions', 60, 700, 60), item('Employer', 500, 700, 50)],
      1,
    )

    expect(placed).toHaveLength(2)
    const [first, second] = placed
    expect(first?.box?.x).toBe(60)
    expect(first?.box?.width).toBe(60)
    expect(second?.box?.x).toBe(500)
    expect(second?.box?.width).toBe(50)
  })

  it('sits the box around the baseline rather than on it', () => {
    const [line] = placeLines([item('Gross', 60, 700, 30)], 1)

    // A zero-height rectangle on the baseline is invisible and a highlight has
    // to cover the letters it is about.
    expect(line?.box?.y).toBeLessThan(700)
    expect((line?.box?.y ?? 0) + (line?.box?.height ?? 0)).toBeGreaterThan(700)
  })

  it('places a real document, one box per line, all of them on the page', async () => {
    const extract = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))
    if (extract.kind !== 'text') throw new Error('expected text')

    const lines = extract.text.split('\n')
    expect(extract.layout.lines).toHaveLength(lines.length)
    expect(extract.layout.pages).toHaveLength(extract.pages)

    const [size] = extract.layout.pages
    if (size === undefined) throw new Error('expected a page size')

    for (const [index, box] of extract.layout.lines.entries()) {
      if (lines[index]?.trim() === '') continue
      if (box === undefined) throw new Error(`line ${index} has no box`)
      expect(box.page).toBe(1)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1)
      expect(box.height).toBeGreaterThan(0)
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1)
    }
  })

  it('puts the box for a named line where that line is printed', async () => {
    const extract = await extractPdfText(new Uint8Array(readFileSync(FIXTURE)))
    if (extract.kind !== 'text') throw new Error('expected text')

    const lines = extract.text.split('\n')
    const gross = lines.findIndex((line) => line.startsWith('סה"כ ברוטו'))
    const net = lines.findIndex((line) => line.startsWith('נטו לתשלום'))
    expect(gross).toBeGreaterThan(-1)
    expect(net).toBeGreaterThan(-1)

    // Net is printed below the gross, and a PDF's y grows upward — so the box
    // the surface draws for it has to be lower down the page. This is the
    // check that a box belongs to *its own* line rather than to some line.
    const grossBox = extract.layout.lines[gross]
    const netBox = extract.layout.lines[net]
    expect(grossBox?.y).toBeGreaterThan(netBox?.y ?? 0)
  })
})
