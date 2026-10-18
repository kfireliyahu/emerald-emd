import { money, type CurrencyCode, type Money } from '@/core/money.ts'

/**
 * **What is in the bank, split between the goals saved there and the cushion**
 * (M30 U7, D-360).
 *
 * Every bank account and cash counts until the person unticks it (D-371). Their latest statements are what
 * is in the bank (D-325). Each goal saved in one of them holds its part — its
 * deposits into that account's own cash holding (D-354) — and **the cushion is
 * what is left**, held up against its target.
 *
 * **Parts that add up to more than is there are a failed check, never clamped.**
 * Two checks run: the whole sum against the whole balance, and each account's
 * parts against that account's balance, so a failure names the account that is
 * short. When the whole sum fails there is no cushion to measure and `left` is
 * undefined — a figure shrunk to zero would be a smaller number and not a truer
 * one. An account that fails while the whole adds up leaves the cushion standing:
 * money moved between two ticked accounts keeps the whole true, and the check
 * still says which account the goals say more of than it holds.
 *
 * **A ticked account with no balance leaves the split unchecked in whole**
 * (D-149, D-224's rule for a sum): the balance would be a smaller number, not a
 * truer one.
 */
export interface CushionAccountInput {
  readonly accountId: string
  readonly name: string
  readonly last4: string | undefined
  /** Its latest statement's balance; undefined when no statement offered one. */
  readonly balance: Money | undefined
  readonly counts: boolean
}

/** One goal's money in one account: the net of its deposits into that account's cash. */
export interface GoalPartInput {
  readonly goalId: string
  readonly goalName: string
  readonly accountId: string
  readonly amount: Money
}

export interface AccountShort {
  readonly accountId: string
  readonly name: string
  readonly last4: string | undefined
  readonly balance: Money
  /** What the goals saved there hold. */
  readonly parts: Money
  /** How much more the parts are than the balance: always above zero. */
  readonly by: Money
}

export type CushionSplitCheck =
  | { readonly kind: 'ADDS_UP' }
  | { readonly kind: 'OVER'; readonly by: Money }
  /** A ticked account has no balance, so nothing can be said. */
  | { readonly kind: 'UNCHECKED'; readonly withoutBalance: readonly string[] }
  /** No account counts: there is none, or every one is unticked. */
  | { readonly kind: 'NO_ACCOUNTS' }

export interface CushionSplit {
  /** The ticked accounts' balances; undefined when one of them has none. */
  readonly balance: Money | undefined
  /** Each goal's part in a ticked account, largest first. */
  readonly parts: readonly GoalPartInput[]
  readonly partsTotal: Money
  /** Balance less the parts: the cushion. Undefined when the check did not pass. */
  readonly left: Money | undefined
  readonly check: CushionSplitCheck
  /** The ticked accounts whose goals hold more than they do. */
  readonly short: readonly AccountShort[]
  /** Left less the target: positive is above it. Undefined without both. */
  readonly above: Money | undefined
}

export function cushionSplit(input: {
  readonly accounts: readonly CushionAccountInput[]
  readonly parts: readonly GoalPartInput[]
  readonly target: Money | undefined
  readonly currency: CurrencyCode
}): CushionSplit {
  const { currency } = input
  const ticked = input.accounts.filter((account) => account.counts)
  const tickedIds = new Set(ticked.map((account) => account.accountId))
  const parts = input.parts
    .filter((part) => tickedIds.has(part.accountId) && part.amount.currency === currency && part.amount.minor !== 0)
    .slice()
    .sort((a, b) => b.amount.minor - a.amount.minor || a.goalName.localeCompare(b.goalName))
  const partsTotal = money(
    parts.reduce((sum, part) => sum + part.amount.minor, 0),
    currency,
  )

  const short: AccountShort[] = []
  for (const account of ticked) {
    if (account.balance === undefined) continue
    const held = parts.filter((part) => part.accountId === account.accountId).reduce((sum, part) => sum + part.amount.minor, 0)
    if (held > account.balance.minor) {
      short.push({
        accountId: account.accountId,
        name: account.name,
        last4: account.last4,
        balance: account.balance,
        parts: money(held, currency),
        by: money(held - account.balance.minor, currency),
      })
    }
  }

  const none = { balance: undefined, parts, partsTotal, left: undefined, short, above: undefined }
  if (ticked.length === 0) return { ...none, short: [], check: { kind: 'NO_ACCOUNTS' } }
  const withoutBalance = ticked.filter((account) => account.balance === undefined)
  if (withoutBalance.length > 0) {
    return { ...none, check: { kind: 'UNCHECKED', withoutBalance: withoutBalance.map((account) => account.name) } }
  }

  const balance = money(
    ticked.reduce((sum, account) => sum + (account.balance?.minor ?? 0), 0),
    currency,
  )
  if (partsTotal.minor > balance.minor) {
    return { ...none, balance, check: { kind: 'OVER', by: money(partsTotal.minor - balance.minor, currency) } }
  }
  const left = money(balance.minor - partsTotal.minor, currency)
  return {
    balance,
    parts,
    partsTotal,
    left,
    check: { kind: 'ADDS_UP' },
    short,
    above: input.target === undefined ? undefined : money(left.minor - input.target.minor, currency),
  }
}
