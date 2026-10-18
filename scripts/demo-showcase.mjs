/**
 * **The document the ledger's pictures are taken from** (M33 F12): a made-up
 * year in `.demo/showcase.emd`, from `fixtures/synthetic/demo/showcase.json`,
 * written through the plugin's own tools as every demo document is.
 *
 * The tours' documents stay as they are — a tour replays against exactly the
 * rows it was written for — so the split, where the money went, wealth and the
 * year are drawn from a document of their own, full enough that no screen is
 * empty and nothing on it is red that is not the point.
 *
 * The card statements are not files in the repository: one is written per
 * month in the layout of the tour's own (`card-statement-2026-08.xlsx`), from
 * the fixture's shops and a seeded generator, so every build draws the same
 * figures, and each is imported as a person would import it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const XLSX = createRequire(import.meta.url)('xlsx')

/** mulberry32: small, seeded, and the same on every machine. */
function generator(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cents = (major) => Math.round(major * 100)
const major = (minor) => minor / 100
const money = (minor) => `₪ ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (year, month, d) => `${d}/${month}/${String(year).slice(2)}`

function nextMonth(year, month) {
  return month === 12 ? [year + 1, 1] : [year, month + 1]
}

/** One month's charges at the fixture's shops and bills. */
function charges(source, random, index, year, month) {
  const between = ([low, high]) => low + random() * (high - low)
  const rows = []
  const used = new Set()
  const dayFor = (name) => {
    for (;;) {
      const d = 1 + Math.floor(random() * 28)
      if (!used.has(`${name}:${d}`)) {
        used.add(`${name}:${d}`)
        return d
      }
    }
  }
  for (const shop of source.shops) {
    if (shop.fixed !== undefined) {
      rows.push({ d: dayFor(shop.name), name: shop.name, minor: cents(shop.fixed) })
      continue
    }
    const visits = Math.round(between(shop.visits)) + (month === 12 && shop.december !== undefined ? shop.december : 0)
    for (let i = 0; i < visits; i += 1) rows.push({ d: dayFor(shop.name), name: shop.name, minor: cents(between(shop.amount)) })
  }
  for (const bill of source.bills) {
    if (bill.every !== undefined && index % bill.every !== 0) continue
    const minor = bill.fixed !== undefined ? cents(bill.fixed) : cents(between(bill.amount))
    // A bill keeps its day, which is how the detector tells it from a shop (M37 F2);
    // the draw is still taken, so every other figure stays the one it was.
    const drawn = dayFor(bill.name)
    rows.push({ d: bill.day ?? drawn, name: bill.name, minor })
  }
  return rows.sort((a, b) => a.d - b.d)
}

/** The month's statement, in the tour's statement's layout, written to `file`. */
function writeStatement(file, source, rows, year, month) {
  const [chargeYear, chargeMonth] = nextMonth(year, month)
  const total = rows.reduce((sum, row) => sum + row.minor, 0)
  const sheet = [
    ['Everyday Card — a made-up statement', '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['Card holder', source.card.holder, '', '', '', '', ''],
    ['Billing period', day(year, month, 1), '', '', '', '', ''],
    ['Total charged', (total / 100).toFixed(2), '', '', '', '', ''],
    ['Card number', `****${source.card.last4}`, '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['Transaction date', 'Merchant', 'Transaction amount', 'Charge amount', 'Charge date', 'Installments', 'Notes'],
    ...rows.map((row) => [
      day(year, month, row.d),
      row.name,
      money(row.minor),
      money(row.minor),
      day(chargeYear, chargeMonth, 2),
      '',
      '',
    ]),
    ['', '', '', '', '', '', ''],
    ['Total', '', '', (total / 100).toFixed(2), '', '', ''],
  ]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), 'Transactions')
  XLSX.writeFile(book, file)
}

/** Every month from `first` to `last`, as YYYY-MM. */
function monthsOf(source) {
  const months = []
  let [year, month] = source.first.split('-').map(Number)
  for (;;) {
    const period = `${year}-${String(month).padStart(2, '0')}`
    months.push(period)
    if (period === source.last) return months
    ;[year, month] = nextMonth(year, month)
  }
}

/** The gross in force in a month: the latest change at or before it. */
function grossIn(source, period) {
  const changes = Object.entries(source.pay.gross).filter(([from]) => from <= period).sort()
  return changes[changes.length - 1][1]
}

/** A month's paycheck: every line from the fixture's rates, net what is left of gross. */
function paycheck(source, period) {
  const pay = source.pay
  const gross = cents(grossIn(source, period))
  const of = (rate) => Math.round(gross * rate)
  const lines = [
    { deduction_type_id: 'ded:income-tax', employee: of(pay.income_tax) },
    { deduction_type_id: 'ded:national-insurance', employee: of(pay.national_insurance) },
    { deduction_type_id: 'ded:health-tax', employee: of(pay.health_tax) },
    { deduction_type_id: 'ded:pension', employee: of(pay.pension.employee), employer: of(pay.pension.employer), basis: gross },
    { deduction_type_id: 'ded:study-fund', employee: of(pay.study_fund.employee), employer: of(pay.study_fund.employer), basis: gross },
    { deduction_type_id: 'ded:severance', employee: 0, employer: of(pay.severance), basis: gross },
    { deduction_type_id: 'ded:union-dues', employee: cents(pay.union_dues) },
  ]
  const net = gross - lines.reduce((sum, line) => sum + line.employee, 0)
  const [year, month] = period.split('-').map(Number)
  const [paidYear, paidMonth] = nextMonth(year, month)
  return {
    period,
    payment_date: `${paidYear}-${String(paidMonth).padStart(2, '0')}-01`,
    gross: major(gross),
    net: major(net),
    lines: lines.map((line) => ({
      deduction_type_id: line.deduction_type_id,
      employee_amount: major(line.employee),
      ...(line.employer === undefined ? {} : { employer_amount: major(line.employer) }),
      ...(line.basis === undefined ? {} : { basis_amount: major(line.basis) }),
    })),
  }
}

/** The ids of the bills in a `plans` answer, by name. */
function billIds(plansText) {
  const ids = new Map()
  const table = /^\| Bill \| Id \|[^\n]*\n\|[^\n]*\n((?:\|[^\n]*\n)*)/m.exec(plansText)?.[1] ?? ''
  for (const match of table.matchAll(/^\| ([^|]+?) \| ([0-9a-f-]{36}) \|/gm)) ids.set(match[1].trim(), match[2])
  return ids
}

export async function makeShowcase(target, source, ask) {
  // A batch can apply part of itself and refuse the rest in prose; here any refusal stops the build.
  const call = async (name, args) => {
    const text = await ask(name, args)
    if (/^Refused/m.test(text)) throw new Error(`${name} refused part of it:\n${text.slice(0, 1200)}`)
    return text
  }
  const random = generator(source.seed)
  const months = monthsOf(source)
  const shopsAndBills = [...source.shops, ...source.bills]

  // Rules first, so every statement is filed as it is read.
  for (const each of shopsAndBills) {
    const rule = { path: target, pattern: each.name, category_id: each.category }
    const preview = await call('create_rule', rule)
    const confirmation = /confirmation: "([^"]+)"/.exec(preview)?.[1]
    if (confirmation === undefined) throw new Error(`create_rule printed no token:\n${preview.slice(0, 600)}`)
    await call('create_rule', { ...rule, confirmation, commit: true })
  }

  const scratch = mkdtempSync(path.join(tmpdir(), 'emerald-showcase-'))
  try {
    for (const [index, period] of months.entries()) {
      const [year, month] = period.split('-').map(Number)
      const file = path.join(scratch, `card-statement-${period}.xlsx`)
      writeStatement(file, source, charges(source, random, index, year, month), year, month)
      await call('import_statement', {
        path: target,
        file,
        new_account: { name: source.card.name, kind: source.card.kind, last4: source.card.last4 },
        ...(index === 0 ? { save_mapping_as: source.card.reader } : {}),
        commit: true,
      })
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  await call('record_paychecks', {
    path: target,
    paychecks: months.map((period) => paycheck(source, period)),
    commit: true,
  })
  await call('create_goals', { path: target, goals: source.goals, commit: true })
  await call('create_debts', { path: target, debts: source.debts, commit: true })
  await call('record_fund_readings', {
    path: target,
    readings: source.funds.flatMap(({ readings, ...fund }) =>
      readings.map(([asOf, balance]) => ({ ...fund, as_of_date: asOf, total_balance: balance })),
    ),
    commit: true,
  })
  await call('set_deduction_types', {
    path: target,
    types: [
      { type: 'ded:pension', pays_into: 'Pension fund' },
      { type: 'ded:study-fund', pays_into: 'Study fund' },
      { type: 'ded:severance', pays_into: 'Pension fund' },
    ],
    commit: true,
  })

  // The bills: the card's, found by the detector over the year, and the rent it cannot see.
  await call('track_fixed_expenses', {
    path: target,
    window_months: 12,
    ending_at: source.last,
    expenses: [
      ...source.bills.map((bill) => ({
        merchant: bill.name.toUpperCase(),
        cadence: bill.cadence,
        ...(bill.discretionary ? { is_discretionary: true } : {}),
      })),
      { name: source.rent.name, expected_amount: source.rent.expected_amount, cadence: 'MONTHLY', category_id: 'cat:rent' },
    ],
    commit: true,
  })
  await call('dismiss_fixed_expense_candidates', { path: target, merchants: source.shops.map((shop) => shop.name.toUpperCase()) })

  // The plan, its bills out of net, and every month on it.
  await call('set_plan', {
    path: target,
    plans: [{ create: true, name: source.plan.name, make_default: true, basis: { kind: 'LAST_PAYCHECK' }, buckets: source.plan.buckets }],
    commit: true,
  })
  const bills = billIds(await call('plans', { path: target }))
  await call('set_fixed_expense_roles', {
    path: target,
    roles: [...bills.values()].map((id) => ({ fixed_expense_id: id, role: 'net' })),
    commit: true,
  })
  for (const month of months) await call('plan_month', { path: target, month, commit: true })
}
