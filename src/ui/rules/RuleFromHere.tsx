import { useNavigate } from 'react-router-dom'

import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import type { RuleDraft } from '@/domain/ruleEditing.ts'
import { useT } from '@/i18n/current.ts'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { RuleEditor } from '@/ui/rules/RuleEditor.tsx'

/**
 * **A rule made where it was asked for** (M64 F15, D-634) — the maintainer,
 * 2026-11-26: *"when creating a rule can we stay at the screen where we wanted
 * to create it? e.g im at transactions creating a rule for a transaction. i
 * dont wanna go to rules."*
 *
 * Transactions and By merchant open Rules' own editor in their side panel, with
 * the draft already in it, and save it there: the person stays where they were,
 * and the note that says it was made offers *Open in Rules* and an Undo. The
 * editor is the whole one — kind, pattern, category, conditions — so a broad
 * rule (a provider's heading) still has its reach on screen before it is saved
 * (D-042), which is why it used to go to Rules.
 */
export function RuleFormPanel({
  draft,
  categories,
  accounts,
  onSave,
  onClose,
}: {
  draft: RuleDraft
  categories: readonly Category[]
  accounts: readonly Account[]
  onSave: (draft: RuleDraft) => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <SidePanel title={t('rules.newRule')} onClose={onClose}>
      <RuleEditor
        key={`${draft.kind}|${draft.pattern}|${draft.targetCategoryId}`}
        initial={draft}
        isNew
        categories={categories}
        accounts={accounts}
        onSave={onSave}
        onCancel={onClose}
      />
    </SidePanel>
  )
}

/** Going to Rules, offered and never done: opens the rule just made there, in its editor. */
export function OpenInRules({ ruleId }: { ruleId: string }) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="fc-text-action shrink-0"
      onClick={() => navigate('/categories/rules', { state: { rule: ruleId } })}
    >
      {t('rules.openInRules')}
    </button>
  )
}
