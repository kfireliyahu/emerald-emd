import { useMemo } from 'react'

import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { ColumnRole } from '@/domain/model/importing.ts'
import { useT } from '@/i18n/current.ts'
import { reading } from '@/i18n/en/reading.ts'

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
export const ROLE_LABEL: Readonly<Record<ColumnRole, string>> = reading.roles

/**
 * The roles' labels in the language now (M60 U4, D-589): the catalogue's
 * `reading.roles`, which `ROLE_LABEL` is the English of.
 */
export function useRoleLabels(): Readonly<Record<ColumnRole, string>> {
  const t = useT()
  return useMemo(() => {
    const labels: Partial<Record<ColumnRole, string>> = {}
    for (const role of Object.keys(ROLE_LABEL) as ColumnRole[]) labels[role] = t(`reading.roles.${role}`)
    return labels as Record<ColumnRole, string>
  }, [t])
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
