import { add, equals, subtract, type Money } from '@/core/money.ts'

/**
 * An account's opening balance, and whether the books add up to the statement
 * (M28 U8, D-325).
 *
 * **Opening balance is a fact about the account on a date** — what it held
 * before the first statement began — and the document cannot read it off any
 * file, so a person says it once. It stands for everything before that date.
 * What follows from it is a sum the document *can* check: the opening balance,
 * plus what the statements moved since, has to equal the balance the last
 * statement ended on. **Three states, as everywhere** (D-149): `ADDS_UP`,
 * `OFF` by an amount, or `UNCHECKED` — and unchecked says *why*, because "you
 * have not told me the opening balance" and "no statement printed a balance" are
 * different things to do something about.
 */
export type OpeningCheck =
  | { readonly kind: 'ADDS_UP' }
  /** `missing` is the statement's balance less what opening plus movement reaches. */
  | { readonly kind: 'OFF'; readonly missing: Money }
  | { readonly kind: 'UNCHECKED'; readonly reason: 'NO_OPENING' | 'NO_STATEMENT_BALANCE' | 'MIXED_CURRENCY' }

export function openingCheck(
  opening: Money | undefined,
  moved: Money,
  statementBalance: Money | undefined,
): OpeningCheck {
  if (opening === undefined) return { kind: 'UNCHECKED', reason: 'NO_OPENING' }
  if (statementBalance === undefined) return { kind: 'UNCHECKED', reason: 'NO_STATEMENT_BALANCE' }
  if (
    opening.currency !== moved.currency ||
    opening.currency !== statementBalance.currency
  ) {
    return { kind: 'UNCHECKED', reason: 'MIXED_CURRENCY' }
  }
  const reached = add(opening, moved)
  if (equals(reached, statementBalance)) return { kind: 'ADDS_UP' }
  return { kind: 'OFF', missing: subtract(statementBalance, reached) }
}

/** What a sentence under the row says about a check that could not be made. */
export function uncheckedReason(reason: 'NO_OPENING' | 'NO_STATEMENT_BALANCE' | 'MIXED_CURRENCY'): string {
  switch (reason) {
    case 'NO_OPENING':
      return 'Say what the account held before its first statement to check it.'
    case 'NO_STATEMENT_BALANCE':
      return 'No imported statement printed a running balance, so there is nothing to check against.'
    case 'MIXED_CURRENCY':
      return 'The opening balance and the statements are in different currencies.'
  }
}
