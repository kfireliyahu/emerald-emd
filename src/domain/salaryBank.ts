/**
 * What the bank said about a salary, in words (D-317).
 *
 * One function so the screen and the conversation say the same sentence: a
 * paycheck that agrees in the app and reads differently in a tool would be the
 * two halves of D-227 disagreeing about a fact. The formatters come in because
 * the screen and the plugin spell money and dates their own ways.
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import type { SalaryBank } from '@/domain/model/statistics.ts'

export interface SalaryWords {
  readonly money: (value: Money) => string
  readonly date: (value: LocalDate) => string
}

export function salaryBankWords(bank: SalaryBank, words: SalaryWords): string {
  switch (bank.kind) {
    case 'AGREES':
      return `${words.money(bank.landed)} landed ${words.date(bank.landedOn)}, agrees with the slip`
    case 'DIFFERS': {
      const more = bank.difference.minor > 0
      const gap = words.money({ ...bank.difference, minor: Math.abs(bank.difference.minor) })
      return `${words.money(bank.landed)} landed ${words.date(bank.landedOn)}: ${gap} ${more ? 'more' : 'less'} than the slip's net`
    }
    case 'NO_DEPOSIT':
      return 'no deposit in the bank statements for this slip'
    case 'UNCHECKED':
      return 'not checked: no bank statement for the month it was paid'
    case 'NO_SLIP':
      return 'filed as salary, and no payslip accounts for it'
  }
}
