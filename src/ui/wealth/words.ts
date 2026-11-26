import { useMemo } from 'react'

import type { NetWorthGap } from '@/domain/netWorth.ts'
import type { DepositStatus } from '@/domain/funds.ts'
import type { DebtKind } from '@/domain/model/debt.ts'
import type { FundType } from '@/domain/model/funds.ts'
import type { HoldingPlaceKind } from '@/domain/model/savings.ts'
import type { NewPlaceKind } from '@/data/repositories/goalWhereRepository.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import type { NetWorthGroup, Reach } from '@/ui/wealth/netWorthRows.ts'

/**
 * **Wealth's names for the kinds it shows, in the language on screen** (M64 U10,
 * D-622). What is left of `debts/labels.ts` and `savings/labels.ts` stays English
 * for the screens that have not moved to the catalogue yet (`funds/labels.ts` went
 * with M64 F26); a redesigned Wealth screen reads its kinds from here, so a Hebrew screen
 * never shows an English kind beside a Hebrew sentence.
 */
export interface WealthWords {
  readonly t: Translate
  readonly dates: DateWords
  readonly group: Readonly<Record<NetWorthGroup, string>>
  readonly place: Readonly<Record<HoldingPlaceKind, string>>
  readonly newPlace: Readonly<Record<NewPlaceKind, string>>
  readonly fund: Readonly<Record<FundType, string>>
  readonly debt: Readonly<Record<DebtKind, string>>
  readonly deposit: Readonly<Record<DepositStatus, string>>
  readonly reach: (reach: Reach) => string
  /** One holding, in a few words: `a deposit`. */
  readonly holdingKind: (held: { readonly holding?: { readonly kind: string } | undefined } | undefined) => string
  readonly gap: (gap: NetWorthGap) => string
}

export function useWealthWords(): WealthWords {
  const t = useT()
  const dates = useDates()
  return useMemo(
    () => ({
      t,
      dates,
      group: {
        BANK: t('wealth.kinds.group.BANK'),
        HOLDINGS: t('wealth.kinds.group.HOLDINGS'),
        BY_HAND: t('wealth.kinds.group.BY_HAND'),
        FUNDS: t('wealth.kinds.group.FUNDS'),
        OWED: t('wealth.kinds.group.OWED'),
      },
      place: {
        CHECKING: t('wealth.kinds.place.CHECKING'),
        DEPOSIT: t('wealth.kinds.place.DEPOSIT'),
        INVESTMENT: t('wealth.kinds.place.INVESTMENT'),
        CASH: t('wealth.kinds.place.CASH'),
        OTHER: t('wealth.kinds.place.OTHER'),
      },
      newPlace: {
        CASH_AT_HOME: t('wealth.kinds.newPlace.CASH_AT_HOME'),
        DEPOSIT: t('wealth.kinds.newPlace.DEPOSIT'),
        FUND: t('wealth.kinds.newPlace.FUND'),
        OTHER: t('wealth.kinds.newPlace.OTHER'),
      },
      fund: {
        PENSION: t('wealth.kinds.fund.PENSION'),
        STUDY_FUND: t('wealth.kinds.fund.STUDY_FUND'),
        PROVIDENT: t('wealth.kinds.fund.PROVIDENT'),
        MANAGERS_INSURANCE: t('wealth.kinds.fund.MANAGERS_INSURANCE'),
        PROVIDENT_FOR_INVESTMENT: t('wealth.kinds.fund.PROVIDENT_FOR_INVESTMENT'),
      },
      debt: {
        MORTGAGE: t('wealth.kinds.debt.MORTGAGE'),
        BANK_LOAN: t('wealth.kinds.debt.BANK_LOAN'),
        CARD_INSTALLMENTS: t('wealth.kinds.debt.CARD_INSTALLMENTS'),
        PAYROLL_LOAN: t('wealth.kinds.debt.PAYROLL_LOAN'),
        PERSONAL: t('wealth.kinds.debt.PERSONAL'),
        OTHER: t('wealth.kinds.debt.OTHER'),
      },
      deposit: {
        WITHIN_TOLERANCE: t('wealth.kinds.deposit.WITHIN_TOLERANCE'),
        DEPOSITS_MISSING: t('wealth.kinds.deposit.DEPOSITS_MISSING'),
        DEPOSITS_EXCEED_PAYSLIPS: t('wealth.kinds.deposit.DEPOSITS_EXCEED_PAYSLIPS'),
        ACKNOWLEDGED: t('wealth.kinds.deposit.ACKNOWLEDGED'),
      },
      reach: (reach: Reach) =>
        reach === 'Reachable' ? t('wealth.kinds.reach.reachable') : reach === 'Locked' ? t('wealth.kinds.reach.locked') : t('wealth.kinds.reach.part'),
      holdingKind: (held) => {
        switch (held?.holding?.kind) {
          case 'DEPOSIT':
            return t('wealth.kinds.holding.deposit')
          case 'FUND':
            return t('wealth.kinds.holding.fund')
          case 'CASH':
            return t('wealth.kinds.holding.cash')
          default:
            return t('wealth.kinds.holding.other')
        }
      },
      gap: (gap: NetWorthGap) => {
        const count = gap.count
        switch (gap.kind) {
          case 'UNKNOWN_HOLDING':
            return t(countKey('wealth.kinds.gap.unknownHolding', count), { count })
          case 'OTHER_CURRENCY_DEPOSIT':
            return t(countKey('wealth.kinds.gap.otherCurrencyDeposit', count), { count })
          case 'OTHER_CURRENCY_DEBT':
            return t(countKey('wealth.kinds.gap.otherCurrencyDebt', count), { count })
          case 'UNCHECKED_DEBT':
            return t(countKey('wealth.kinds.gap.uncheckedDebt', count), { count })
        }
      },
    }),
    [t, dates],
  )
}
