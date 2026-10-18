import { useMemo, useState } from 'react'

import { monthRange } from '@/core/time.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import { loadRules } from '@/data/repositories/ruleSetRepository.ts'
import {
  commitReapply,
  listReapplyCandidates,
  undoReapply,
  undoableRun,
} from '@/data/repositories/reapplyRepository.ts'
import { monthlyTotals, type TransactionFilter } from '@/data/repositories/transactionRepository.ts'
import { planReapply } from '@/domain/reapply.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import { accountLabel } from '@/ui/rules/ruleText.ts'

/** How many of the changes the preview shows by name before it stops listing them. */
const SAMPLE = 6

interface Scope {
  readonly accountId: string
  readonly period: string
  readonly uncategorizedOnly: boolean
}

const EVERYTHING: Scope = { accountId: '', period: '', uncategorizedOnly: false }

/**
 * Run the current rules over transactions that are already in the ledger — F03's
 * re-apply, and the only place in this app where something can be undone.
 *
 * **The preview is not a separate step.** The count updates as the scope
 * changes, because computing it is a pure function over rows already in memory
 * and hiding that behind a "Preview" button would only add a click between the
 * user and the number they are deciding on. The number they read is produced by
 * the same `planReapply` call that produces the rows that land, so it cannot be
 * an estimate.
 *
 * Nothing here is automatic. A re-apply happens when this button is pressed, it
 * never touches a category chosen by hand (D-009), and it never clears one — see
 * `@/domain/reapply.ts`.
 */
export function ReapplyPanel({
  accounts,
  categoryPath,
  onClose,
}: {
  accounts: readonly Account[]
  categoryPath: (categoryId: string) => string | undefined
  onClose: () => void
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [scope, setScope] = useState<Scope>(EVERYTHING)
  // Only the undo needs a message of its own. What an *apply* did is already on
  // screen as the run offering to be taken back, and saying it twice would read
  // as two things having happened.
  const [undone, setUndone] = useState<{ asked: number; restored: number } | undefined>()

  const data = useMemo(() => {
    if (db === undefined) return undefined

    const candidates = listReapplyCandidates(db, toFilter(scope))
    const plan = planReapply(loadRules(db), candidates)
    const merchants = new Map(candidates.map((row) => [row.id, row.merchantRaw]))

    return {
      plan,
      merchants,
      months: [...new Set(monthlyTotals(db).map((total) => total.period))],
      undoable: undoableRun(db),
    }
  }, [db, revision, scope])

  if (data === undefined) return null

  const { plan, undoable } = data
  const label = describe(scope, accounts)

  const apply = (): void => {
    setUndone(undefined)
    mutate((database) => {
      commitReapply(database, plan, label, Date.now())
    })
  }

  const undo = (): void => {
    if (undoable === undefined) return
    const asked = undoable.changedCount
    let restored = 0
    mutate((database) => {
      restored = undoReapply(database, undoable.id, Date.now())
    })
    setUndone({ asked, restored })
  }

  return (
    <section
      aria-label="Apply rules to existing transactions"
      className="fc-pop-enter shrink-0 border-b border-hairline bg-surface px-6 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">Apply rules to transactions already imported</span>

        <label className="flex items-center gap-2 text-caption text-ink-secondary">
          Account
          <select
            value={scope.accountId}
            onChange={(event) => setScope({ ...scope, accountId: event.target.value })}
            className={`${SELECT} text-body`}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-caption text-ink-secondary">
          Month
          <select
            value={scope.period}
            onChange={(event) => setScope({ ...scope, period: event.target.value })}
            className={`${SELECT} text-body`}
          >
            <option value="">All time</option>
            {data.months.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-caption text-ink-secondary select-none">
          <input
            type="checkbox"
            checked={scope.uncategorizedOnly}
            onChange={(event) => setScope({ ...scope, uncategorizedOnly: event.target.checked })}
          />
          Only rows with no category
        </label>

        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="tabular-nums">
          {plan.scanned === 0 ? (
            <span className="text-ink-secondary">
              Nothing in this scope. Every row in it was categorized by hand, or there are none.
            </span>
          ) : (
            <>
              {plan.scanned} {plan.scanned === 1 ? 'transaction' : 'transactions'},{' '}
              <span className={plan.changes.length === 0 ? 'text-ink-secondary' : 'font-medium'}>
                {plan.changes.length === 0 ? 'none would change' : `${plan.changes.length} would change`}
              </span>
            </>
          )}
        </p>

        <Button
          variant="primary"
          size="sm"
          onClick={apply}
          disabled={plan.changes.length === 0}
          title={label}
        >
          {plan.changes.length === 0
            ? 'Apply'
            : `Apply ${plan.changes.length} ${plan.changes.length === 1 ? 'change' : 'changes'}`}
        </Button>

        {undone !== undefined && (
          <span className="text-caption text-ink-secondary">
            <span className="tabular-nums">{undone.restored}</span> put back.
            {undone.restored < undone.asked && (
              <>
                {' '}
                The other <span className="tabular-nums">{undone.asked - undone.restored}</span> you
                have categorized by hand since, and those are yours.
              </>
            )}
          </span>
        )}

        {/* Separated with a middot rather than a comma: the scope can end in an
            RTL account name, and punctuation immediately after one lands on the
            wrong side of it. */}
        {undoable !== undefined && (
          <span className="flex items-center gap-2 text-caption text-ink-tertiary">
            Last run: <Bidi>{undoable.scope}</Bidi>
            {' · '}
            <span className="tabular-nums">{undoable.changedCount}</span> changed
            <Button variant="secondary" size="sm" onClick={undo}>
              Undo it
            </Button>
          </span>
        )}
      </div>

      {/* What the number means, in rows the user can recognise. A count on its
          own is a number to trust or not; three merchant names is a number to
          check. */}
      {plan.changes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-tertiary">
          {plan.changes.slice(0, SAMPLE).map((change) => (
            <li key={change.rowId}>
              <Bidi className="text-ink-secondary">
                {data.merchants.get(change.rowId) ?? 'a transaction'}
              </Bidi>
              {': '}
              {change.from === undefined ? 'uncategorized' : (categoryPath(change.from) ?? 'a deleted category')}
              {' → '}
              <span className="text-ink">{categoryPath(change.to) ?? 'a deleted category'}</span>
            </li>
          ))}
          {plan.changes.length > SAMPLE && (
            <li className="tabular-nums">and {plan.changes.length - SAMPLE} more</li>
          )}
        </ul>
      )}

      <p className="mt-2 text-caption text-ink-tertiary">
        A category you picked by hand is never touched, and nothing is ever cleared — a row whose
        rule was deleted keeps what it was given. This is the one thing in the app you can undo,
        and the offer stays until you run it again.
      </p>
    </section>
  )
}

/** The scope as the repository asks for it. */
function toFilter(scope: Scope): TransactionFilter {
  const bounds = scope.period === '' ? undefined : monthRange(scope.period)
  return {
    accountId: scope.accountId === '' ? undefined : scope.accountId,
    from: bounds?.from,
    to: bounds?.to,
    uncategorized: scope.uncategorizedOnly ? true : undefined,
  }
}

/**
 * The scope in the words the panel showed, stored on the run.
 *
 * Written down rather than rebuilt later: the account it names can be renamed
 * afterwards, and the sentence offering an undo has to describe what was
 * actually done at the time.
 */
function describe(scope: Scope, accounts: readonly Account[]): string {
  const parts: string[] = []
  const account = accounts.find((candidate) => candidate.id === scope.accountId)
  if (account !== undefined) parts.push(accountLabel(account))
  if (scope.period !== '') parts.push(scope.period)
  if (scope.uncategorizedOnly) parts.push('uncategorized only')
  return parts.length === 0 ? 'Everything' : parts.join(' · ')
}
