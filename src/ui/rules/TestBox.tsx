import { useMemo, useState } from 'react'

import { fromMajorUnits, zero, type CurrencyCode } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import { explain, matches } from '@/domain/categorization.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { CURRENCY_CHOICES, accountLabel } from '@/ui/rules/ruleText.ts'
import { Why } from '@/ui/rules/Why.tsx'

/**
 * Type a merchant and an amount; see which rule fires, and what it shadowed.
 *
 * This is the tool F03 calls the reason the whole system is trustworthy, and it
 * earns that by calling `explain` — the same comparator and the same predicate
 * `firstMatch` uses on an import. There is no second matching implementation
 * here to drift out of agreement with the first one, which is why the box
 * cannot lie about what an import will do.
 *
 * It reads the rule set and writes nothing. `hitCount` moves on a real import
 * or a re-apply, never on a question.
 */
export function TestBox({
  rules,
  categoryPath,
  accounts,
}: {
  rules: readonly CategoryRule[]
  categoryPath: (categoryId: string) => string | undefined
  accounts: readonly Account[]
}) {
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('ILS')
  const [providerCategory, setProviderCategory] = useState('')
  const [accountId, setAccountId] = useState(() => accounts[0]?.id ?? '')

  const asked = merchant.trim() !== '' || amount.trim() !== '' || providerCategory.trim() !== ''

  const subject = useMemo<RuleSubject>(() => {
    const magnitude = parseAmountText(amount)
    return {
      merchantNormalized: normalizeMerchant(merchant),
      providerCategory: providerCategory.trim() === '' ? undefined : providerCategory,
      // Signed as a charge, because that is what a statement row is (D-004).
      // The sign changes nothing — bounds are compared as magnitudes — and
      // showing it as an outflow is the honest picture of what is being tested.
      amount:
        magnitude === undefined ? zero(currency) : fromMajorUnits(-Math.abs(magnitude), currency),
      accountId,
    }
  }, [merchant, amount, currency, providerCategory, accountId])

  const result = useMemo(() => explain(rules, subject), [rules, subject])

  // Rules that are switched off match nothing, by the same predicate. Saying so
  // is the difference between "no rule covers this" and "the rule you turned
  // off last week covered this".
  const suppressed = useMemo(
    () =>
      rules.filter((rule) => !rule.isEnabled && matches({ ...rule, isEnabled: true }, subject))
        .length,
    [rules, subject],
  )

  const normalized = subject.merchantNormalized

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 border-t border-hairline px-6 py-4 lg:w-96 lg:border-t-0 lg:border-l">
      <div>
        <h2 className="text-label text-ink-tertiary uppercase">Test box</h2>
        <p className="mt-1 text-caption text-ink-tertiary">
          A row as it would arrive from a statement. The answer here is the answer an import
          gives — same rules, same comparison.
        </p>
      </div>

      <input
        value={merchant}
        onChange={(event) => setMerchant(event.target.value)}
        placeholder="Merchant, as the file writes it"
        aria-label="Merchant name to test"
        dir="auto"
        className={FIELD}
      />

      <div className="flex items-center gap-2">
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount"
          aria-label="Amount to test"
          className={`${FIELD} w-28 tabular-nums`}
        />
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          aria-label="Currency of the test amount"
          className={SELECT}
        >
          {CURRENCY_CHOICES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      <input
        value={providerCategory}
        onChange={(event) => setProviderCategory(event.target.value)}
        placeholder="Provider category, if the file states one"
        aria-label="Provider category to test"
        dir="auto"
        className={FIELD}
      />

      {accounts.length > 0 && (
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          aria-label="Account the test row is on"
          className={SELECT}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {accountLabel(account)}
            </option>
          ))}
        </select>
      )}

      {!asked ? (
        <p className="text-caption text-ink-tertiary">
          Nothing typed yet. Paste a merchant name off a statement — the rules see it normalized,
          which is shown here once there is something to normalize.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Why an obvious-looking pattern misses is almost always this: the
              rules compare the normalized form, branch number stripped. */}
          {normalized !== merchant.trim() && (
            <p className="text-caption text-ink-tertiary">
              rules see <Bidi className="text-ink-secondary">{normalized === '' ? '—' : normalized}</Bidi>
            </p>
          )}

          <div>
            {result.winner === undefined ? (
              <>
                <p className="text-heading">Uncategorized</p>
                <p className="mt-1 text-caption text-ink-secondary">
                  No rule matches. An import would leave this row for you to categorize.
                </p>
              </>
            ) : (
              <>
                <p className="text-heading">
                  {categoryPath(result.winner.targetCategoryId) ?? 'a category that was deleted'}
                </p>
                <p className="mt-1 text-caption text-ink-secondary">
                  by <Bidi className="text-ink">{result.winner.name}</Bidi>
                </p>
                <p className="text-caption text-ink-tertiary">
                  <Why rule={result.winner} accounts={accounts} />
                </p>
              </>
            )}
          </div>

          {result.shadowed.length > 0 && (
            <div>
              <p className="text-label text-ink-tertiary uppercase">
                also matched, and lost
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {result.shadowed.map((rule) => (
                  <li key={rule.id} className="text-caption text-ink-tertiary">
                    <Bidi className="text-ink-secondary">{rule.name}</Bidi> ·{' '}
                    <Why rule={rule} accounts={accounts} /> →{' '}
                    {categoryPath(rule.targetCategoryId) ?? 'a category that was deleted'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {suppressed > 0 && (
            <p className="text-caption text-ink-tertiary">
              {suppressed === 1 ? '1 rule that is switched off' : `${suppressed} rules that are switched off`}{' '}
              would have matched.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

