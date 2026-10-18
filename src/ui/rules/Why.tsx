import type { Account } from '@/data/repositories/accountRepository.ts'
import type { CategoryRule } from '@/domain/model/rules.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { KIND_PHRASE, accountLabel, amountText } from '@/ui/rules/ruleText.ts'

/**
 * What a rule tested, in one line.
 *
 * Its own file because three places describe a rule now — the rules list, the
 * test box, and a transaction's provenance — and a rule that reads three ways
 * is a rule the user has to learn three times.
 */
export function Why({ rule, accounts }: { rule: CategoryRule; accounts: readonly Account[] }) {
  const scoped = accounts.find((account) => account.id === rule.conditions.scopeAccountId)
  const band = amountText(rule.conditions)

  return (
    <>
      {KIND_PHRASE[rule.kind]}
      {rule.pattern !== '' && (
        <>
          {' '}
          <Bidi className="text-ink-secondary">{rule.pattern}</Bidi>
        </>
      )}
      {rule.conditions.scopeAccountId !== undefined && (
        <>
          {' · on '}
          <Bidi>{scoped === undefined ? 'a deleted account' : accountLabel(scoped)}</Bidi>
        </>
      )}
      {band !== undefined && ` · ${band}`}
    </>
  )
}
