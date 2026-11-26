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
import { MENU_MOST, ValueChoice } from '@/ui/components/ChoiceField.tsx'
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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length === 0) onSave(draft.name.trim() === '' ? { ...draft, name: defaultName } : draft)
      }}
    >
      {note !== undefined && <p className="m-0 text-ink-secondary">{note}</p>}

      {/* A form in the side panel (D-617): the fields one under another, in reading order. */}
      <div className="flex flex-col gap-3">
        <input
          autoFocus
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          // The placeholder is the name it will actually get, not a hint: the
          // pattern is what most rules would be called anyway.
          placeholder={defaultName}
          aria-label={t('rules.editor.ruleName')}
          dir="auto"
          className={`${FIELD} w-full`}
        />

        <ValueChoice
          value={draft.kind}
          choices={RULE_KINDS.map((kind) => ({ value: kind, label: t(KIND_WORD[kind]) }))}
          onChange={(kind) => setDraft((current) => withKind(current, kind as RuleKind))}
          aria-label={t('rules.editor.matchesOn')}
        />

        {takesPattern(draft.kind) && (
          <input
            value={draft.pattern}
            onChange={(event) => setDraft((current) => ({ ...current, pattern: event.target.value }))}
            placeholder={PATTERN_PLACEHOLDER[draft.kind]}
            aria-label={t('rules.editor.pattern')}
            // Almost every pattern is a Hebrew merchant name.
            dir="auto"
            className={`${FIELD} w-full`}
          />
        )}

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
      <div className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
        <label className="flex items-center gap-2">
          {t('rules.editor.onlyOn')}
          <ValueChoice
            value={draft.conditions.scopeAccountId ?? ''}
            choices={[
              { value: '', label: t('rules.editor.anyAccount') },
              ...accounts.map((account) => ({ value: account.id, label: accountLabel(account) })),
            ]}
            filter={accounts.length > MENU_MOST}
            onChange={(accountId) =>
              setDraft((current) => ({
                ...current,
                conditions: { ...current.conditions, scopeAccountId: accountId === '' ? undefined : accountId },
              }))
            }
            aria-label={t('rules.editor.restrict')}
            className={`${SELECT} h-7 text-ink`}
          />
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

        <ValueChoice
          value={currency}
          choices={CURRENCY_CHOICES.map((code) => ({ value: code, label: code }))}
          onChange={(code) => setBounds(minText, maxText, code)}
          aria-label={t('rules.editor.currency')}
          className={`${SELECT} h-7 text-ink`}
        />

        {/* Bounds are magnitudes: a charge is negative by the importer's
            convention (D-004), so a signed bound would match nothing. */}
        <span>{t('rules.editor.sizes')}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" type="submit" disabled={problems.length > 0}>
          {isNew ? t('rules.editor.addRule') : t('rules.editor.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('rules.editor.cancel')}
        </Button>

        {/* One line each, beside the button that will not fire until they are
            gone. A regex that will not compile says so here rather than at
            import time (F03). */}
        {/* Each its own item: bare text runs merge into one, and the gap between them goes. */}
        <span className="flex flex-wrap items-center gap-x-4 text-caption text-negative">
          {[
            problemFor('pattern'),
            problemFor('conditions'),
            problemFor('targetCategoryId'),
            unreadable(minText) ? t('rules.editor.smallestNaN') : undefined,
            unreadable(maxText) ? t('rules.editor.largestNaN') : undefined,
          ]
            .filter((line): line is string => line !== undefined)
            .map((line) => (
              <span key={line}>{line}</span>
            ))}
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
