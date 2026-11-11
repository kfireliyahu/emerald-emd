import { useMemo, useState } from 'react'

import { fromMajorUnits, zero, type CurrencyCode } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import { explain, matches } from '@/domain/categorization.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'
import { useT } from '@/i18n/current.ts'
import { pathArrows } from '@/i18n/words.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
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
  const t = useT()
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
    <aside className="flex w-full shrink-0 flex-col gap-3 border-t border-hairline px-6 py-4 lg:w-96 lg:border-t-0 lg:border-s">
      <div>
        <h2 className="text-label text-ink-tertiary uppercase">{t('rules.test.title')}</h2>
        <p className="mt-1 text-caption text-ink-tertiary">
          {t('rules.test.lead')}
        </p>
      </div>

      <input
        value={merchant}
        onChange={(event) => setMerchant(event.target.value)}
        placeholder={t('rules.test.merchant')}
        aria-label={t('rules.test.merchantLabel')}
        dir="auto"
        className={FIELD}
      />

      <div className="flex items-center gap-2">
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t('rules.test.amount')}
          aria-label={t('rules.test.amountLabel')}
          className={`${FIELD} w-28 tabular-nums`}
        />
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          aria-label={t('rules.test.currency')}
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
        placeholder={t('rules.test.provider')}
        aria-label={t('rules.test.providerLabel')}
        dir="auto"
        className={FIELD}
      />

      {accounts.length > 0 && (
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          aria-label={t('rules.test.account')}
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
          {t('rules.test.nothingYet')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Why an obvious-looking pattern misses is almost always this: the
              rules compare the normalized form, branch number stripped. */}
          {normalized !== merchant.trim() && (
            <p className="text-caption text-ink-tertiary">
              <Phrase
                text={t('rules.test.rulesSee')}
                parts={{ normalized: <Bidi className="text-ink-secondary">{normalized === '' ? '—' : normalized}</Bidi> }}
              />
            </p>
          )}

          <div>
            {result.winner === undefined ? (
              <>
                <p className="text-heading">{t('rules.test.uncategorized')}</p>
                <p className="mt-1 text-caption text-ink-secondary">
                  {t('rules.test.noMatch')}
                </p>
              </>
            ) : (
              <>
                <p className="text-heading">
                  <Bidi>{pathArrows(categoryPath(result.winner.targetCategoryId) ?? t('rules.test.deleted'))}</Bidi>
                </p>
                <p className="mt-1 text-caption text-ink-secondary">
                  <Phrase text={t('rules.test.by')} parts={{ name: <Bidi className="text-ink">{result.winner.name}</Bidi> }} />
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
                {t('rules.test.alsoMatched')}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {result.shadowed.map((rule) => (
                  <li key={rule.id} className="text-caption text-ink-tertiary">
                    <Bidi className="text-ink-secondary">{rule.name}</Bidi>
                    {' · '}
                    <Why rule={rule} accounts={accounts} />
                    {t('rules.arrow')}
                    <Bidi>{pathArrows(categoryPath(rule.targetCategoryId) ?? t('rules.test.deleted'))}</Bidi>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {suppressed > 0 && (
            <p className="text-caption text-ink-tertiary">
              {suppressed === 1 ? t('rules.test.oneOff') : t('rules.test.nOff', { n: suppressed })}
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

