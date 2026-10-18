import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { ColumnRole } from '@/domain/model/importing.ts'

/**
 * What each role is called on screen. The identifiers are for code; docs/f01
 * calls these "charge date", "original amount", "provider category", and so
 * should anything the user reads.
 *
 * Shared between the mapper, where a role is assigned, and the mappings screen,
 * where a saved one is read back. A generated label would do for most of them
 * and then quietly disagree on the ones that matter: `installmentText` is
 * "installments", and the counter pair reads "installment no." / "installment
 * of" rather than as two identifiers.
 */
export const ROLE_LABEL: Readonly<Record<ColumnRole, string>> = {
  date: 'date',
  amount: 'amount',
  merchant: 'merchant',
  debit: 'debit (out)',
  credit: 'credit (in)',
  chargeDate: 'charge date',
  currency: 'currency',
  originalAmount: 'original amount',
  originalCurrency: 'original currency',
  exchangeRate: 'exchange rate',
  providerCategory: 'provider category',
  installmentText: 'installments',
  installmentSequence: 'installment no.',
  installmentTotal: 'installment of',
  cardLast4: 'card last 4',
  reference: 'reference',
  balance: 'running balance',
  note: 'note',
}

/**
 * The label for a role, or **the role itself** when nothing shipped one (D-213).
 *
 * A role somebody added has no entry in any of the three maps and never will —
 * the maps are hand-written because a generated label quietly disagrees on the
 * ones that matter. Falling back to the identifier is honest: it is the word
 * they typed, and it is what the grammar carries.
 *
 * Shared by all three pickers, so the fallback cannot be right in one and
 * missing in another.
 */
export function labelFor(
  labels: Readonly<Record<string, string>>,
  role: ColumnRoleId,
): string {
  return labels[role] ?? role
}
