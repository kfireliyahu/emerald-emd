import { useState } from 'react'

import { fromMajorUnits, formatMoney, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import { takesPattern } from '@/domain/categorization.ts'
import { RULE_KINDS, type RuleKind } from '@/domain/model/rules.ts'
import { draftProblems, withKind, type RuleDraft } from '@/domain/ruleEditing.ts'
import { useT } from '@/i18n/current.ts'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import {
  CURRENCY_CHOICES,
  KIND_WORD,
  PATTERN_PLACEHOLDER,
  accountLabel,
  problemWords,
} from '@/ui/rules/ruleText.ts'

/**
 * Writing one rule: what it matches on, what it assigns, and the conditions it
 * ANDs onto that.
 *
 * A panel at the foot of the screen rather than a modal, so the list it is
 * about stays on screen — the reason to write a rule is usually something
 * already in that list, and the reason to check the order is always.
 *
 * It refuses to save what the engine would refuse to run: the messages come
 * from `validateRule` through `draftProblems`, which is the same check an
 * import's rules went through, so "the editor accepted it" and "the engine can
 * evaluate it" cannot come apart.
 */
export function RuleEditor({
  initial,
  isNew,
  note,
  categories,
  accounts,
  onSave,
  onCancel,
}: {
  initial: RuleDraft
  isNew: boolean
  /**
   * One sentence about what saving will do, when that is not simply "save this
   * rule" — editing a built-in writes a copy and switches the original off, and
   * the place to say so is the panel doing it rather than a tooltip on the row
   * that opened it.
   */
  note?: string | undefined
  categories: readonly Category[]
  accounts: readonly Account[]
  onSave: (draft: RuleDraft) => void
  onCancel: () => void
}) {
  const t = useT()
  const [draft, setDraft] = useState(initial)
  const [minText, setMinText] = useState(() => boundText(initial.conditions.amountMin))
  const [maxText, setMaxText] = useState(() => boundText(initial.conditions.amountMax))
  const [currency, setCurrency] = useState<CurrencyCode>(
    () => initial.conditions.amountMin?.currency ?? initial.conditions.amountMax?.currency ?? 'ILS',
  )

  const problems = draftProblems(draft)
  const problemFor = (field: 'pattern' | 'conditions' | 'targetCategoryId'): string | undefined => {
    const message = problems.find((problem) => problem.field === field)?.message
    return message === undefined ? undefined : problemWords(message)
  }

  // The name it gets when none is typed — `resolvedName`'s, in the language now,
  // and saved as the name when the field is left empty, so the placeholder is
  // what the rule is called (M60 U5, D-590).
  const pattern = draft.pattern.trim()
  const defaultName = takesPattern(draft.kind)
    ? pattern === ''
      ? t('rules.editor.newRuleName')
      : pattern
    : draft.kind === 'ACCOUNT'
      ? t('rules.editor.accountRule')
      : t('rules.editor.amountRule')

  const setBounds = (min: string, max: string, code: CurrencyCode): void => {
    setMinText(min)
    setMaxText(max)
    setCurrency(code)
    setDraft((current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        amountMin: toBound(min, code),
        amountMax: toBound(max, code),
      },
    }))
  }

  return (
    <form
      className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length === 0) onSave(draft.name.trim() === '' ? { ...draft, name: defaultName } : draft)
      }}
      // Escape leaves the panel the same way it leaves every other transient
      // thing in the app.
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      {note !== undefined && <p className="mb-3 text-caption text-ink-tertiary">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          // The placeholder is the name it will actually get, not a hint: the
          // pattern is what most rules would be called anyway.
          placeholder={defaultName}
          aria-label={t('rules.editor.ruleName')}
          dir="auto"
          className={`${FIELD} w-52`}
        />

        <select
          value={draft.kind}
          onChange={(event) => setDraft((current) => withKind(current, event.target.value as RuleKind))}
          aria-label={t('rules.editor.matchesOn')}
          className={SELECT}
        >
          {RULE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_WORD[kind])}
            </option>
          ))}
        </select>

        {takesPattern(draft.kind) && (
          <input
            value={draft.pattern}
            onChange={(event) => setDraft((current) => ({ ...current, pattern: event.target.value }))}
            placeholder={PATTERN_PLACEHOLDER[draft.kind]}
            aria-label={t('rules.editor.pattern')}
            // Almost every pattern is a Hebrew merchant name.
            dir="auto"
            className={`${FIELD} w-60`}
          />
        )}

        <span className="text-ink-tertiary">{t('rules.editor.arrow')}</span>
        <CategoryPicker
          categories={categories}
          value={draft.targetCategoryId === '' ? undefined : draft.targetCategoryId}
          onChange={(categoryId) =>
            setDraft((current) => ({ ...current, targetCategoryId: categoryId ?? '' }))
          }
          label={t('rules.editor.categoryLabel')}
        />
      </div>

      {/* The conditions, quieter than the rule itself: they narrow what is
          above rather than being a second rule (D-037). */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
        <label className="flex items-center gap-2">
          {t('rules.editor.onlyOn')}
          <select
            value={draft.conditions.scopeAccountId ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                conditions: {
                  ...current.conditions,
                  scopeAccountId: event.target.value === '' ? undefined : event.target.value,
                },
              }))
            }
            aria-label={t('rules.editor.restrict')}
            className={`${SELECT} h-7 text-ink`}
          >
            <option value="">{t('rules.editor.anyAccount')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          {t('rules.editor.amountFrom')}
          <input
            value={minText}
            onChange={(event) => setBounds(event.target.value, maxText, currency)}
            placeholder={t('rules.editor.any')}
            aria-label={t('rules.editor.smallest')}
            className={`${FIELD} h-7 w-24 text-ink tabular-nums`}
          />
        </label>

        <label className="flex items-center gap-2">
          {t('rules.editor.upTo')}
          <input
            value={maxText}
            onChange={(event) => setBounds(minText, event.target.value, currency)}
            placeholder={t('rules.editor.any')}
            aria-label={t('rules.editor.largest')}
            className={`${FIELD} h-7 w-24 text-ink tabular-nums`}
          />
        </label>

        <select
          value={currency}
          onChange={(event) => setBounds(minText, maxText, event.target.value)}
          aria-label={t('rules.editor.currency')}
          className={`${SELECT} h-7 text-ink`}
        >
          {CURRENCY_CHOICES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        {/* Bounds are magnitudes: a charge is negative by the importer's
            convention (D-004), so a signed bound would match nothing. */}
        <span className="text-ink-tertiary">{t('rules.editor.sizes')}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
          {isNew ? t('rules.editor.addRule') : t('rules.editor.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('rules.editor.cancel')}
        </Button>

        {/* One line each, beside the button that will not fire until they are
            gone. A regex that will not compile says so here rather than at
            import time (F03). */}
        <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
          {problemFor('pattern')}
          {problemFor('conditions')}
          {problemFor('targetCategoryId')}
          {unreadable(minText) && t('rules.editor.smallestNaN')}
          {unreadable(maxText) && t('rules.editor.largestNaN')}
        </span>
      </div>
    </form>
  )
}

/** A bound as an editable number: no symbol, so what is read back is what was typed. */
function boundText(amount: Money | undefined): string {
  return amount === undefined ? '' : formatMoney(amount, { symbol: false })
}

/**
 * A typed bound, as a magnitude.
 *
 * Read with the importer's own amount reader rather than a second one, so
 * `₪1,234.56` pasted straight off a statement means what it looks like.
 */
function toBound(text: string, currency: CurrencyCode): Money | undefined {
  const value = parseAmountText(text)
  return value === undefined ? undefined : fromMajorUnits(Math.abs(value), currency)
}

/** Typed, but not a number — as opposed to left empty, which means "any". */
function unreadable(text: string): boolean {
  return text.trim() !== '' && parseAmountText(text) === undefined
}
