/**
 * **The synthetic year** (M64 U16, D-611): fourteen made-up months in
 * `.demo/year.emd`, from `fixtures/synthetic/demo/year/year.json`, standing in
 * for a real ledger now that no session reads the maintainer's own (D-608).
 *
 * **What intake makes, not what a script would like.** Every statement is a
 * file — an English card's xlsx, a Hebrew card's xlsx, a bank account's and a
 * savings account's csv — written per month from the fixture with a seeded
 * generator, so every build draws the same figures, and read through the
 * ledger's own `import_statement`, which refuses a file whose printed total
 * does not reconcile. What has no reader in a conversation (the slips, the fund
 * readings, the goals, the debt, the plan) goes in through the tools a
 * conversation uses.
 *
 * **Its calendar is the build's.** The last of the fourteen months is the one
 * the build runs in, still running: its bank rows stop at today and no card
 * statement covers it. The months before it are counted back from it, so the
 * year never goes stale; the figures are the same every build because the
 * generator draws by the month's index, not by its date.
 *
 * The cases a real ledger shows, each on purpose (the brief's list):
 *   - a bank account and two cards, billed early the next month (the 2nd and
 *     the 10th), so a card purchase and the bill that pays it fall in two months
 *     — today's rule counts it by the bill, U1's by the purchase (D-607)
 *   - installments over three and twelve payments, a slice on each statement
 *   - the second card's statement missing for one month, the bank still paying it
 *   - refunds on both cards; transfers between the person's own two accounts;
 *     one transfer to investments larger than that month's left over
 *   - monthly slips with tax, pension and study fund, December's with a bonus
 *   - rent and bills that repeat, and one (the internet) whose price changes
 *   - English and Hebrew shops, a few of them left uncategorized
 *   - two goals with deposits, two funds with quarterly readings, a debt, and a
 *     plan whose restaurants budget the months run over
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const pad = (n) => String(n).padStart(2, '0')
const shekels = (minor) => `₪ ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plain = (minor) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A month `offset` months after `year`-`month`. */
function shift(year, month, offset) {
  const at = year * 12 + (month - 1) + offset
  return { year: Math.floor(at / 12), month: (at % 12) + 1 }
}

/** The fourteen months, oldest first; the last is today's and still running. */
export function yearMonths(today, count) {
  return Array.from({ length: count }, (_, index) => {
    const { year, month } = shift(today.year, today.month, index - (count - 1))
    return { index, year, month, period: `${year}-${pad(month)}` }
  })
}

const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`
const slashed = (year, month, day) => `${pad(day)}/${pad(month)}/${year}`
const shortSlashed = (year, month, day) => `${day}/${month}/${String(year).slice(2)}`

/** Every purchase on every card in one month, drawn in a fixed order. */
function cardMonth(source, random, index) {
  const between = ([low, high]) => low + random() * (high - low)
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
  const byCard = new Map(source.cards.map((card) => [card.key, []]))
  for (const shop of source.shops) {
    const visits = Math.round(between(shop.visits))
    for (let i = 0; i < visits; i += 1) {
      byCard.get(shop.card).push({ d: dayFor(shop.name), name: shop.name, minor: cents(between(shop.amount)) })
    }
  }
  for (const bill of source.card_bills) {
    const fixed = bill.changes !== undefined && index >= bill.changes.from ? bill.changes.fixed : bill.fixed
    byCard.get(bill.card).push({ d: bill.day, name: bill.name, minor: cents(fixed) })
  }
  for (const each of source.installments) {
    const sequence = index - each.first + 1
    if (sequence < 1 || sequence > each.payments) continue
    const total = cents(each.total)
    const slice = Math.round(total / each.payments)
    // The first slice carries the remainder, as a card's statement does.
    const minor = sequence === 1 ? total - slice * (each.payments - 1) : slice
    byCard.get(each.card).push({ d: each.day, name: each.name, minor, total, sequence, of: each.payments, bought: each.first })
  }
  for (const refund of source.refunds) {
    if (refund.month === index) byCard.get(refund.card).push({ d: refund.day, name: refund.name, minor: -cents(refund.amount) })
  }
  for (const rows of byCard.values()) rows.sort((a, b) => a.d - b.d)
  return byCard
}

/** A card's month as the xlsx its issuer would send: English or Hebrew. */
function writeCardStatement(file, card, rows, months, index) {
  const { year, month } = months[index]
  const charged = shift(year, month, 1)
  const total = rows.reduce((sum, row) => sum + row.minor, 0)
  const purchased = (row) => (row.bought === undefined ? { year, month } : months[row.bought] ?? shift(year, month, row.bought - index))
  let sheet
  if (card.layout === 'en') {
    sheet = [
      [`${card.name} — a made-up statement`, '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['Card holder', card.holder, '', '', '', '', ''],
      ['Billing period', shortSlashed(year, month, 1), '', '', '', '', ''],
      ['Total charged', (total / 100).toFixed(2), '', '', '', '', ''],
      ['Card number', `****${card.last4}`, '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['Transaction date', 'Merchant', 'Transaction amount', 'Charge amount', 'Charge date', 'Installments', 'Notes'],
      ...rows.map((row) => {
        const bought = purchased(row)
        return [
          shortSlashed(bought.year, bought.month, row.d),
          row.name,
          shekels(row.total ?? row.minor),
          shekels(row.minor),
          shortSlashed(charged.year, charged.month, card.charge_day),
          row.sequence === undefined ? '' : `Payment ${row.sequence} of ${row.of}`,
          row.minor < 0 ? 'Refund' : '',
        ]
      }),
      ['', '', '', '', '', '', ''],
      ['Total', '', '', (total / 100).toFixed(2), '', '', ''],
    ]
  } else {
    sheet = [
      [`${card.name} — פירוט עסקאות לדוגמה`],
      [],
      ['מספר כרטיס', `****${card.last4}`],
      ['מועד חיוב', slashed(charged.year, charged.month, card.charge_day)],
      [],
      ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב', 'תאריך חיוב', 'תשלומים'],
      ...rows.map((row) => {
        const bought = purchased(row)
        return [
          slashed(bought.year, bought.month, row.d),
          row.name,
          major(row.total ?? row.minor),
          major(row.minor),
          slashed(charged.year, charged.month, card.charge_day),
          row.sequence === undefined ? '' : `תשלום ${row.sequence} מתוך ${row.of}`,
        ]
      }),
      ['', '', '', '', 'סה"כ לחיוב', major(total)],
    ]
  }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), card.layout === 'en' ? 'Transactions' : 'עסקאות')
  XLSX.writeFile(book, file)
  return total
}

const csvCell = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/** A bank account's month as the csv its bank would export, a running balance on every row. */
function writeBankStatement(file, account, opening, rows, from, to) {
  let balance = opening
  const lines = [
    [account.title, '', '', '', '', '', ''],
    [`תנועות בחשבון ${account.number}`, '', '', '', '', '', ''],
    [`מתאריך ${from} עד תאריך ${to}`, '', '', '', '', '', ''],
    ['יתרת פתיחה', plain(opening), '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['תאריך', 'תאריך ערך', 'תיאור', 'אסמכתא', 'חובה', 'זכות', 'יתרה'],
  ]
  for (const [n, row] of rows.entries()) {
    balance += row.minor
    lines.push([
      row.date,
      row.date,
      row.name,
      String(4400000 + n + Math.abs(row.minor % 997)),
      row.minor < 0 ? plain(-row.minor) : '',
      row.minor > 0 ? plain(row.minor) : '',
      plain(balance),
    ])
  }
  writeFileSync(file, `${lines.map((line) => line.map(csvCell).join(',')).join('\n')}\n`)
  return balance
}

/** The gross in force for a slip `index` months after the first month. */
function grossAt(pay, index) {
  return pay.gross.filter(([from]) => from <= index).at(-1)[1]
}

/** A slip: tax, national insurance, health tax, pension, study fund and severance off the fixture's rates. */
function slip(pay, index, year, month) {
  const base = cents(grossAt(pay, index))
  const bonus = month === pay.bonus.calendar_month ? cents(pay.bonus.amount) : 0
  const gross = base + bonus
  const of = (amount, rate) => Math.round(amount * rate)
  const lines = [
    { deduction_type_id: 'ded:income-tax', employee: of(gross, pay.income_tax) },
    { deduction_type_id: 'ded:national-insurance', employee: of(gross, pay.national_insurance) },
    { deduction_type_id: 'ded:health-tax', employee: of(gross, pay.health_tax) },
    { deduction_type_id: 'ded:pension', employee: of(base, pay.pension.employee), employer: of(base, pay.pension.employer), basis: base },
    { deduction_type_id: 'ded:study-fund', employee: of(base, pay.study_fund.employee), employer: of(base, pay.study_fund.employer), basis: base },
    { deduction_type_id: 'ded:severance', employee: 0, employer: of(base, pay.severance), basis: base },
  ]
  const net = gross - lines.reduce((sum, line) => sum + line.employee, 0)
  return {
    period: `${year}-${pad(month)}`,
    payment_date: iso(year, month, pay.day),
    gross: major(gross),
    net: major(net),
    employer_name: pay.employer,
    ...(bonus === 0 ? {} : { is_irregular: true, note: pay.bonus.note }),
    lines: lines.map((line) => ({
      deduction_type_id: line.deduction_type_id,
      employee_amount: major(line.employee),
      ...(line.employer === undefined ? {} : { employer_amount: major(line.employer) }),
      ...(line.basis === undefined ? {} : { basis_amount: major(line.basis) }),
    })),
  }
}

/** The first id in a markdown table row that mentions `text`. */
function idBeside(answer, text) {
  for (const line of answer.split('\n')) {
    if (!line.includes(text)) continue
    const id = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(line)?.[0]
    if (id !== undefined) return id
  }
  return undefined
}

/** The ids of the bills in a `plans` answer, by name. */
function billIds(plansText) {
  const ids = new Map()
  const table = /^\| Bill \| Id \|[^\n]*\n\|[^\n]*\n((?:\|[^\n]*\n)*)/m.exec(plansText)?.[1] ?? ''
  for (const match of table.matchAll(/^\| ([^|]+?) \| ([0-9a-f-]{36}) \|/gm)) ids.set(match[1].trim(), match[2])
  return ids
}

/**
 * Writes the year into the document at `target` (made with the ledger pack),
 * calling each tool through `ask(name, args)`, which answers with the tool's
 * text and throws on a refusal. `today` is `{ year, month, day }`.
 */
export async function makeYear(target, source, ask, today) {
  const call = async (name, args) => {
    const text = await ask(name, args)
    if (/^Refused|^\*\*Not imported/m.test(text)) throw new Error(`${name} refused part of it:\n${text.slice(0, 1200)}`)
    return text
  }
  const random = generator(source.seed)
  const months = yearMonths(today, source.months)
  const running = months.length - 1
  const lastFinished = months[running - 1]
  const reached = (index, day) => index < running || day <= today.day
  const { bank, savings, pay } = source

  // Rules first, so every statement is filed as it is read; a shop with no
  // category is left for the person, which is the point of it.
  const filed = new Map()
  for (const each of [...source.shops, ...source.card_bills, ...source.installments, ...bank.bills, ...bank.others, bank.investment]) {
    if (each.category !== null && each.category !== undefined) filed.set(each.name, each.category)
  }
  for (const [pattern, category] of filed) {
    const rule = { path: target, pattern, category_id: category }
    const preview = await call('create_rule', rule)
    const confirmation = /confirmation: "([^"]+)"/.exec(preview)?.[1]
    if (confirmation === undefined) throw new Error(`create_rule printed no token:\n${preview.slice(0, 600)}`)
    await call('create_rule', { ...rule, confirmation, commit: true })
  }

  // The slips first: the bank's salary row is each one's net, paid at the end
  // of its own month, so the running month has none until its day comes.
  const slips = months.map(({ index, year, month }) => slip(pay, index, year, month))

  const scratch = mkdtempSync(path.join(tmpdir(), 'emerald-year-'))
  try {
    const billed = new Map() // `${card}:${index}` → the statement's total, minor
    let checking = cents(bank.opening)
    let saved = cents(savings.opening)
    const accounts = new Set()
    const read = async (file, account, reader) => {
      const known = accounts.has(account.name)
      await call('import_statement', {
        path: target,
        file,
        new_account: { name: account.name, kind: account.kind, last4: account.last4 },
        ...(known || reader === undefined ? {} : { save_mapping_as: reader, ...(account.columns === undefined ? {} : { columns: account.columns }) }),
        commit: true,
      })
      accounts.add(account.name)
    }

    for (const { index, year, month, period } of months) {
      // The cards: every month is drawn, so a missing statement moves no other figure.
      const purchases = cardMonth(source, random, index)
      for (const card of source.cards) {
        if (index === running) continue
        const file = path.join(scratch, `${card.key}-${period}.xlsx`)
        const total = writeCardStatement(file, card, purchases.get(card.key), months, index)
        billed.set(`${card.key}:${index}`, total)
        if (card.missing === index) continue
        await read(file, { name: card.name, kind: 'CREDIT_CARD', last4: card.last4, columns: card.columns }, card.reader)
      }

      // The bank: salary, the cards' bills for last month, rent and bills, the
      // transfer to savings, and once a transfer to investments.
      const rows = []
      const add = (day, name, minor) => {
        if (reached(index, day)) rows.push({ day, date: slashed(year, month, day), name, minor })
      }
      add(pay.day, bank.salary_label, cents(slips[index].net))
      for (const card of source.cards) {
        const total = billed.get(`${card.key}:${index - 1}`)
        if (total !== undefined) add(card.charge_day, card.bank_label, -total)
      }
      const between = ([low, high]) => low + random() * (high - low)
      for (const bill of bank.bills) {
        if (bill.every !== undefined && (index + (bill.offset ?? 0)) % bill.every !== 0) continue
        add(bill.day, bill.name, -(bill.fixed !== undefined ? cents(bill.fixed) : cents(between(bill.amount))))
      }
      for (const other of bank.others) {
        const minor = cents(between(other.amount))
        if (other.months.includes(index)) add(other.day, other.name, -minor)
      }
      add(bank.savings_transfer.day, bank.savings_transfer.name, -cents(bank.savings_transfer.amount))
      if (bank.investment.month === index) add(bank.investment.day, bank.investment.name, -cents(bank.investment.amount))
      rows.sort((a, b) => a.day - b.day)
      const lastDay = index === running ? today.day : new Date(year, month, 0).getDate()
      const from = slashed(year, month, 1)
      const to = slashed(year, month, lastDay)
      const bankFile = path.join(scratch, `bank-${period}.csv`)
      const bankAccount = { ...bank, kind: 'BANK', columns: { 0: 'date', 2: 'merchant', 4: 'debit', 5: 'credit', 6: 'balance' } }
      checking = writeBankStatement(bankFile, bankAccount, checking, rows, from, to)
      await read(bankFile, bankAccount, bank.reader)

      // The savings account: what the transfer brought, and its interest now and then.
      const savingsRows = []
      const credit = (day, name, minor) => {
        if (reached(index, day)) savingsRows.push({ day, date: slashed(year, month, day), name, minor })
      }
      credit(bank.savings_transfer.day, savings.label, cents(bank.savings_transfer.amount))
      if (index % savings.interest.every === savings.interest.every - 1) credit(28, savings.interest.label, cents(savings.interest.amount))
      const savingsFile = path.join(scratch, `savings-${period}.csv`)
      const savingsAccount = { ...savings, title: bank.title, kind: 'BANK' }
      saved = writeBankStatement(savingsFile, savingsAccount, saved, savingsRows, from, to)
      await read(savingsFile, savingsAccount)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  // The bank's card rows pay the cards: the cards' own rows hold that money.
  const info = await call('document_info', { path: target })
  const payments = []
  for (const card of source.cards) {
    const cardId = idBeside(info, card.name)
    const row = await call('transactions', { path: target, search: card.bank_label, limit: 50 })
    const rowId = idBeside(row, `| ${card.bank_label} |`)
    if (cardId === undefined || rowId === undefined) throw new Error(`No ids for ${card.name}:\n${info.slice(0, 800)}\n${row.slice(0, 800)}`)
    payments.push({ transaction_id: rowId, card_account_id: cardId, counts: false })
  }
  await call('set_card_payers', { path: target, payments, commit: true })

  // The transfers between the person's own two accounts.
  const pairs = [...(await call('transfers', { path: target })).matchAll(/^\| ([0-9a-f-]{36}) \|/gm)].map((match) => match[1])
  if (pairs.length > 0) {
    await call('answer_transfers', { path: target, pairs: pairs.map((pair_id) => ({ pair_id, answer: 'transfer' })), commit: true })
  }

  await call('record_paychecks', { path: target, paychecks: slips.filter((one) => one.payment_date <= iso(today.year, today.month, today.day)), commit: true })
  // The funds: a reading at the end of every quarter the year has passed, each
  // after the first saying what the fund received since the one before — the
  // report's "הפקדות" — so the deposit check has something to compare (M64 F39).
  // A deposit lands the month after the salary it was taken from (the check's
  // default lag of one month), so a reading at the end of month M received what
  // the slips of the previous reading's month up to M-1 sent it. The balance is
  // the last one, what arrived, and a made-up return on the last one.
  const quarters = months.filter(({ index, month }) => index < running && month % 3 === 0)
  const sent = (fund, from, to) =>
    slips
      .slice(from, to)
      .flatMap((one) => one.lines)
      .filter((line) => fund.fed_by.includes(line.deduction_type_id))
      .reduce((sum, line) => sum + cents(line.employee_amount) + cents(line.employer_amount ?? 0), 0)
  await call('record_fund_readings', {
    path: target,
    readings: source.funds.flatMap((fund) => {
      let balance = cents(fund.start)
      return quarters.map(({ index, year, month }, n) => {
        const previous = quarters[n - 1]
        const deposits = previous === undefined ? undefined : sent(fund, previous.index, index)
        if (deposits !== undefined) balance += deposits + Math.round(balance * fund.growth_per_quarter)
        return {
          name: fund.name,
          fund_type: fund.fund_type,
          opened_date: fund.opened,
          fee_on_accumulation_basis_points: fund.fee_on_accumulation_basis_points,
          ...(fund.fee_on_deposit_basis_points === undefined ? {} : { fee_on_deposit_basis_points: fund.fee_on_deposit_basis_points }),
          as_of_date: iso(year, month, new Date(year, month, 0).getDate()),
          total_balance: major(balance),
          ...(deposits === undefined ? {} : { deposits_since_previous: major(deposits) }),
        }
      })
    }),
    commit: true,
  })

  // What each slip line pays into, from the fund that says it is fed by it.
  await call('set_deduction_types', {
    path: target,
    types: source.funds.flatMap((fund) => fund.fed_by.map((type) => ({ type, pays_into: fund.name }))),
    commit: true,
  })

  const first = months[0]
  const ahead = (years) => iso(today.year + years, today.month, 1)
  await call('create_goals', {
    path: target,
    goals: source.goals.map(({ years_ahead, deposits: _deposits, ...goal }) => ({
      ...goal,
      target_date: ahead(years_ahead),
      already_there_on: iso(first.year, first.month, 1),
    })),
    commit: true,
  })
  const byHand = source.goals.flatMap((goal) =>
    goal.deposits === undefined
      ? []
      : months
          .filter(({ index }) => goal.deposits.months.includes(index) && reached(index, goal.deposits.day))
          .map(({ year, month }) => ({ goal: goal.name, amount: goal.deposits.amount, date: iso(year, month, goal.deposits.day), holding: { name: goal.default_holding.name } })),
  )
  await call('record_deposits', { path: target, deposits: byHand, commit: true })

  const loan = bank.bills.find((bill) => bill.category === 'cat:loans')
  await call('create_debts', {
    path: target,
    debts: source.debts.map(({ years_before, years_ahead, ...debt }) => ({
      ...debt,
      opened_date: iso(first.year - years_before, first.month, 1),
      expected_end_date: ahead(years_ahead),
    })),
    commit: true,
  })
  await call('record_debt_payments', {
    path: target,
    payments: months
      .filter(({ index }) => reached(index, loan.day))
      .map(({ year, month }) => ({ debt: source.debts[0].name, amount: loan.fixed, date: iso(year, month, loan.day) })),
    commit: true,
  })

  // The bills, found by the detector over the finished months, and the shops dismissed.
  await call('track_fixed_expenses', {
    path: target,
    window_months: 12,
    ending_at: lastFinished.period,
    // A bill the detector does not offer (the second card's gym, whose missing
    // month thins its run) is tracked by its name and amount, as a person would.
    expenses: [...source.card_bills, ...bank.bills.filter((bill) => bill.cadence !== undefined)].map((bill) => ({
      ...(bill.by_name
        ? { name: bill.name, expected_amount: bill.fixed, category_id: bill.category }
        : { merchant: bill.name.toUpperCase() }),
      cadence: bill.cadence,
      ...(bill.discretionary ? { is_discretionary: true } : {}),
    })),
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
  for (const { period } of months) await call('plan_month', { path: target, month: period, commit: true })
}
